"""Synthetic pixels only: bounded DICOM/raster conversion, without SDK calls."""
import importlib.util
from io import BytesIO
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, JPEGBaseline8Bit

IMAGE_DIR = Path(__file__).resolve().parents[1] / 'capricorn-analyze-image'
sys.path.insert(0, str(IMAGE_DIR))
TARGET = IMAGE_DIR / ('imaging.py' if (IMAGE_DIR / 'imaging.py').exists() else 'main.py')
spec = importlib.util.spec_from_file_location('image_processing_under_test', TARGET)
imaging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imaging)


def dicom_bytes(pixels=None, **attrs):
    if pixels is None:
        pixels = np.array([[-1000, -500], [0, 500]], dtype=np.int16)
    meta = FileMetaDataset()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    meta.MediaStorageSOPInstanceUID = '1.2.3.4.5'
    ds = FileDataset(None, {}, file_meta=meta, preamble=b'\0' * 128)
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.Rows, ds.Columns = pixels.shape[-2:]
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.PixelRepresentation = 1
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.Modality = 'CT'
    ds.PixelData = pixels.tobytes()
    for key, value in attrs.items():
        setattr(ds, key, value)
    buf = BytesIO()
    ds.save_as(buf, enforce_file_format=True)
    return buf.getvalue()


def raster_bytes(size=(8, 8), fmt='PNG'):
    buf = BytesIO()
    Image.new('RGB', size, color=(30, 60, 90)).save(buf, format=fmt)
    return buf.getvalue()


class ImageProcessingTests(unittest.TestCase):
    def test_signed_ct_rescale_precedes_exact_window(self):
        raw = dicom_bytes(np.array([[0, 250], [500, 750]], dtype=np.int16),
                          RescaleSlope=2, RescaleIntercept=-1000,
                          WindowCenter=-249.5, WindowWidth=1501)
        jpeg, metadata = imaging.process_dicom(raw)
        result = np.asarray(Image.open(BytesIO(jpeg)).convert('L'))
        np.testing.assert_allclose(result, [[0, 85], [170, 255]], atol=4)
        self.assertEqual(metadata['WindowCenter'], -249.5)
        self.assertEqual(metadata['WindowWidth'], 1501.0)

    def test_window_uses_full_window_range_not_image_extrema(self):
        jpeg, _ = imaging.process_dicom(dicom_bytes(
            np.full((8, 8), -500, dtype=np.int16), WindowCenter=-499.5, WindowWidth=1001))
        self.assertAlmostEqual(float(np.asarray(Image.open(BytesIO(jpeg))).mean()), 127, delta=2)

    def test_monochrome1_inverts_after_window(self):
        raw = dicom_bytes(np.array([[0, 250], [500, 750]], dtype=np.int16),
                          RescaleSlope=2, RescaleIntercept=-1000,
                          WindowCenter=-249.5, WindowWidth=1501,
                          PhotometricInterpretation='MONOCHROME1')
        jpeg, _ = imaging.process_dicom(raw)
        np.testing.assert_allclose(np.asarray(Image.open(BytesIO(jpeg)).convert('L')),
                                   [[255, 170], [85, 0]], atol=4)

    def test_ct_default_lung_window_is_recorded(self):
        _, metadata = imaging.process_dicom(dicom_bytes())
        self.assertEqual(metadata['WindowCenter'], -600.0)
        self.assertEqual(metadata['WindowWidth'], 1500.0)
        self.assertEqual(metadata['WindowSource'], 'CT_LUNG_DEFAULT')

    def test_original_and_preview_sizes_are_distinct(self):
        jpeg, metadata = imaging.process_standard_image(raster_bytes((3000, 1500)), 'untrusted.ext')
        self.assertEqual(metadata['OriginalDimensions'], '3000x1500')
        self.assertEqual(metadata['PreviewDimensions'], '2048x1024')
        self.assertEqual(metadata['Format'], 'PNG')
        self.assertEqual(Image.open(BytesIO(jpeg)).size, (2048, 1024))

    def test_dicom_does_not_return_identifiers_or_free_text(self):
        _, metadata = imaging.process_dicom(dicom_bytes(
            PatientName='SYNTHETIC', PatientID='TEST-ID', PatientSex='O',
            PatientAge='099Y', StudyDescription='synthetic free text',
            SeriesDescription='synthetic free text', BodyPartExamined='SYNTHETIC'))
        self.assertFalse(set(metadata) & {'PatientName', 'PatientID', 'PatientSex', 'PatientAge',
                                         'StudyDescription', 'SeriesDescription', 'BodyPartExamined'})

    def test_multiframe_is_rejected_even_if_frames_equal_one_dimension(self):
        for frames in (2, 0):
            with self.subTest(frames=frames), self.assertRaisesRegex(ValueError, 'single.frame'):
                imaging.process_dicom(dicom_bytes(NumberOfFrames=frames))

    def test_pixel_limit_checked_before_pixel_decode(self):
        raw = dicom_bytes(Rows=4097, Columns=4097)
        with self.assertRaisesRegex(ValueError, 'pixel limit'):
            imaging.process_dicom(raw)

    def test_raster_pixel_cap_and_animated_input_rejected(self):
        with self.assertRaisesRegex(ValueError, 'pixel limit'):
            imaging.process_standard_image(raster_bytes((4097, 4097)))
        buf = BytesIO()
        frames = [Image.new('RGB', (2, 2), color=c) for c in ('white', 'black')]
        frames[0].save(buf, format='PNG', save_all=True, append_images=frames[1:])
        with self.assertRaisesRegex(ValueError, 'single.frame'):
            imaging.process_standard_image(buf.getvalue())

    def test_unsupported_dicom_syntax_is_clear_and_not_decoded(self):
        from pydicom import dcmread
        ds = dcmread(BytesIO(dicom_bytes()))
        ds.file_meta.TransferSyntaxUID = JPEGBaseline8Bit
        with patch.object(imaging.pydicom, 'dcmread', return_value=ds):
            with self.assertRaisesRegex(ValueError, 'transfer syntax'):
                imaging.process_dicom(dicom_bytes())

    def test_deflated_transfer_syntax_is_rejected_before_dataset_decompression(self):
        from pydicom import dcmread
        from pydicom.uid import DeflatedExplicitVRLittleEndian
        ds = dcmread(BytesIO(dicom_bytes()))
        ds.file_meta.TransferSyntaxUID = DeflatedExplicitVRLittleEndian
        output = BytesIO()
        ds.save_as(output, enforce_file_format=True)
        with patch.object(imaging.pydicom, 'dcmread', side_effect=AssertionError('must not decompress')) as reader:
            with self.assertRaisesRegex(ValueError, 'transfer syntax'):
                imaging.process_dicom(output.getvalue())
            reader.assert_not_called()

    def test_prepare_rejects_empty_oversize_unsupported_and_malformed_images(self):
        self.assertTrue(callable(getattr(imaging, 'prepare_image', None)), 'prepare_image API is required')
        for raw, name in [(b'', 'x.png'), (b'x' * (5 * 1024 * 1024 + 1), 'x.png'),
                          (b'not an image', 'x.dcm'), (raster_bytes(fmt='GIF'), 'x.gif')]:
            with self.subTest(name=name, length=len(raw)), self.assertRaises(ValueError):
                imaging.prepare_image(raw, name)

    def test_prepare_uses_pixel_format_without_filename_metadata(self):
        self.assertTrue(callable(getattr(imaging, 'prepare_image', None)), 'prepare_image API is required')
        _, metadata = imaging.prepare_image(raster_bytes(), 'synthetic-private-filename.jpg')
        self.assertEqual(metadata['Format'], 'PNG')
        self.assertNotIn('synthetic-private-filename', str(metadata))


if __name__ == '__main__':
    unittest.main()
