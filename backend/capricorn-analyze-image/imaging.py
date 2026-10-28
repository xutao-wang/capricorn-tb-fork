"""Bounded, transient rendering of a raster image or one DICOM frame.

Uncompressed monochrome DICOM is supported. A CT without a supplied VOI uses
center -600 / width 1500; other images without VOI use their pixel range.
Only technical, validated metadata leaves this module.
"""
from io import BytesIO
import warnings

import numpy as np
from PIL import Image, UnidentifiedImageError
import pydicom
from pydicom.pixels import apply_modality_lut, apply_voi_lut
from pydicom.uid import ExplicitVRBigEndian, ExplicitVRLittleEndian, ImplicitVRLittleEndian

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_PREVIEW_DIMENSION = 2048
_ALLOWED_SYNTAXES = {ExplicitVRLittleEndian, ImplicitVRLittleEndian, ExplicitVRBigEndian}


def _check_file(data):
    if not isinstance(data, bytes) or not data:
        raise ValueError('Image file is empty or invalid')
    if len(data) > MAX_FILE_BYTES:
        raise ValueError('Image file exceeds the 5 MiB limit')


def _check_dimensions(width, height):
    if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
        raise ValueError('Image exceeds the decoded pixel limit')


def _jpeg(image, metadata):
    metadata['OriginalDimensions'] = f'{image.width}x{image.height}'
    if max(image.size) > MAX_PREVIEW_DIMENSION:
        image.thumbnail((MAX_PREVIEW_DIMENSION, MAX_PREVIEW_DIMENSION), Image.Resampling.LANCZOS)
    metadata['PreviewDimensions'] = f'{image.width}x{image.height}'
    output = BytesIO()
    image.convert('RGB').save(output, format='JPEG', quality=92)
    return output.getvalue(), metadata


def _first_number(value):
    if isinstance(value, (list, tuple, pydicom.multival.MultiValue)):
        value = value[0]
    number = float(value)
    if not np.isfinite(number):
        raise ValueError('Invalid DICOM rendering parameters')
    return number


def _window(pixels, center, width, function='LINEAR'):
    if width < 1 or function not in {'LINEAR', 'LINEAR_EXACT', 'SIGMOID'}:
        raise ValueError('Unsupported DICOM VOI window')
    if function == 'SIGMOID':
        return 255.0 / (1.0 + np.exp(np.clip(-4.0 * (pixels - center) / width, -700, 700)))
    if function == 'LINEAR_EXACT':
        return np.clip((pixels - center) / width + 0.5, 0, 1) * 255
    if width == 1:
        return np.where(pixels <= center - 0.5, 0.0, 255.0)
    return np.clip((pixels - (center - 0.5)) / (width - 1) + 0.5, 0, 1) * 255


def process_dicom(data):
    _check_file(data)
    try:
        # Inspect only the uncompressed file-meta group first. dcmread would
        # inflate a deflated dataset even with stop_before_pixels=True.
        stream = BytesIO(data)
        pydicom.filereader.read_preamble(stream, force=False)
        file_meta = pydicom.filereader.read_dataset(
            stream, is_implicit_VR=False, is_little_endian=True,
            stop_when=lambda tag, _vr, _length: tag.group != 0x0002,
        )
        if getattr(file_meta, 'TransferSyntaxUID', None) not in _ALLOWED_SYNTAXES:
            raise ValueError('Unsupported DICOM transfer syntax; use an uncompressed single frame')
        # Read headers next so pixel_array cannot allocate above the cap.
        header = pydicom.dcmread(BytesIO(data), stop_before_pixels=True)
        if int(getattr(header, 'NumberOfFrames', 1)) != 1:
            raise ValueError('Only single-frame DICOM images are supported')
        _check_dimensions(int(header.Columns), int(header.Rows))
        syntax = getattr(header.file_meta, 'TransferSyntaxUID', None)
        if syntax not in _ALLOWED_SYNTAXES:
            raise ValueError('Unsupported DICOM transfer syntax; use an uncompressed single frame')
        photometric = str(getattr(header, 'PhotometricInterpretation', ''))
        if photometric not in {'MONOCHROME1', 'MONOCHROME2'} or int(header.SamplesPerPixel) != 1:
            raise ValueError('Only monochrome single-frame DICOM images are supported')
        if (int(header.BitsAllocated) not in {8, 16}
                or not 1 <= int(header.BitsStored) <= int(header.BitsAllocated)
                or int(header.PixelRepresentation) not in {0, 1}):
            raise ValueError('Unsupported DICOM pixel encoding')
        ds = pydicom.dcmread(BytesIO(data))
        pixels = np.asarray(apply_modality_lut(ds.pixel_array, ds), dtype=np.float64)
        if pixels.ndim != 2 or pixels.shape != (int(header.Rows), int(header.Columns)):
            raise ValueError('Only single-frame DICOM images are supported')
        if not np.isfinite(pixels).all():
            raise ValueError('Invalid DICOM rendering parameters')
        modality = str(getattr(ds, 'Modality', 'UNKNOWN'))
        modality = modality if modality in {'CT', 'CR', 'DX'} else 'UNKNOWN'
        metadata = {'Format': 'DICOM', 'Modality': modality,
                    'PhotometricInterpretation': photometric}
        if getattr(ds, 'VOILUTSequence', None):
            voi = ds.VOILUTSequence[0]
            bits = int(voi.LUTDescriptor[2])
            if not 8 <= bits <= 16:
                raise ValueError('Unsupported DICOM VOI LUT')
            pixels = np.asarray(apply_voi_lut(pixels, ds), dtype=np.float64) * (255.0 / (2 ** bits - 1))
            metadata['WindowSource'] = 'VOI_LUT'
        else:
            center, width = getattr(ds, 'WindowCenter', None), getattr(ds, 'WindowWidth', None)
            if (center is None) != (width is None):
                raise ValueError('Incomplete DICOM VOI window')
            if center is not None or modality == 'CT':
                supplied = center is not None
                center = _first_number(center) if supplied else -600.0
                width = _first_number(width) if supplied else 1500.0
                function = str(getattr(ds, 'VOILUTFunction', 'LINEAR')) if supplied else 'LINEAR'
                pixels = _window(pixels, center, width, function)
                metadata.update(WindowCenter=center, WindowWidth=width, WindowFunction=function,
                                WindowSource='DICOM_WINDOW' if supplied else 'CT_LUNG_DEFAULT')
            else:
                low, high = float(pixels.min()), float(pixels.max())
                pixels = (pixels - low) * (255 / (high - low)) if high > low else np.zeros_like(pixels)
                metadata['WindowSource'] = 'PIXEL_RANGE'
        pixels = np.clip(pixels, 0, 255)
        if photometric == 'MONOCHROME1':
            pixels = 255 - pixels
        return _jpeg(Image.fromarray(pixels.astype(np.uint8)), metadata)
    except ValueError:
        raise
    except Exception:
        raise ValueError('Invalid or unsupported DICOM image') from None


def process_standard_image(data, file_name=''):
    _check_file(data)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in {'JPEG', 'PNG', 'WEBP'}:
                    raise ValueError('Only JPEG, PNG and WebP raster images are supported')
                _check_dimensions(image.width, image.height)
                if getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('Only single-frame raster images are supported')
                return _jpeg(image.convert('RGB'), {'Format': image.format})
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError('Image exceeds the decoded pixel limit') from None
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise ValueError('Invalid or unsupported raster image') from None


def prepare_image(raw_bytes, file_name=''):
    """Return a metadata-free JPEG preview and whitelisted technical metadata."""
    _check_file(raw_bytes)
    if (raw_bytes[128:132] == b'DICM'
            or isinstance(file_name, str) and file_name.lower().endswith(('.dcm', '.dicom'))):
        return process_dicom(raw_bytes)
    return process_standard_image(raw_bytes)
