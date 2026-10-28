"""Firebase identity and request checks before any application operation."""
from functools import wraps
import os
import re
import threading

import firebase_admin
from firebase_admin import auth
from flask import g, jsonify, make_response
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from .config import article_limit, positive_int, project_id

_app_lock = threading.Lock()


def verify_token(token):
    # ADC on Cloud Run uses the runtime identity; no downloaded keys are needed.
    with _app_lock:
        try:
            app = firebase_admin.get_app('capricorn')
        except ValueError:
            app = firebase_admin.initialize_app(
                options={'projectId': project_id()}, name='capricorn')
    return auth.verify_id_token(token, app=app, check_revoked=True)


def _values(name):
    return {value.strip() for value in os.environ.get(name, '').split(',')
            if value.strip()}


def protected_http(handler):
    @wraps(handler)
    def guarded(request=None):
        # Flask routes call without arguments; Functions Framework passes request.
        if request is None:
            from flask import request
        origin = request.headers.get('Origin')
        origins = _values('ALLOWED_ORIGINS')
        emails = {email.lower() for email in _values('ALLOWED_EMAILS')}

        def respond(value, status=None):
            response = make_response(value) if status is None else make_response(jsonify(value), status)
            # Existing handlers return wildcard headers; never retain them.
            for header in ['Access-Control-Allow-Origin', 'Access-Control-Allow-Headers',
                           'Access-Control-Allow-Methods', 'Access-Control-Max-Age']:
                response.headers.pop(header, None)
            response.vary.add('Origin')
            if origin in origins:
                response.headers['Access-Control-Allow-Origin'] = origin
                response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
                response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
                response.headers['Access-Control-Max-Age'] = '3600'
            return response

        if not origins or not emails:
            return respond({'error': 'Service access configuration is incomplete'}, 503)
        if origin and origin not in origins:
            return respond({'error': 'Origin is not allowed'}, 403)
        if request.method == 'OPTIONS':
            requested_method = request.headers.get('Access-Control-Request-Method', 'POST')
            if requested_method != 'POST':
                return respond({'error': 'Method is not allowed'}, 405)
            return respond(('', 204))
        if request.method != 'POST':
            return respond({'error': 'Method is not allowed'}, 405)

        header = request.headers.get('Authorization', '').split()
        if len(header) != 2 or header[0].lower() != 'bearer' or len(header[1]) > 16384:
            return respond({'error': 'Sign in with an approved Google account'}, 401)
        try:
            claims = verify_token(header[1])
        except (auth.InvalidIdTokenError, auth.ExpiredIdTokenError,
                auth.RevokedIdTokenError, auth.UserDisabledError, ValueError):
            return respond({'error': 'Your sign-in session is invalid or expired'}, 401)
        except Exception:
            return respond({'error': 'Sign-in verification is temporarily unavailable'}, 503)

        uid = claims.get('uid')
        provider = claims.get('firebase', {}).get('sign_in_provider')
        email = claims.get('email', '')
        if (not isinstance(uid, str) or not uid or '/' in uid
                or provider != 'google.com' or claims.get('email_verified') is not True
                or not isinstance(email, str) or email.lower() not in emails):
            return respond({'error': 'This Google account is not authorized for Capricorn'}, 403)
        try:
            request.max_content_length = positive_int('MAX_REQUEST_BYTES', 8 * 1024 * 1024)
            payload = request.get_json(silent=True)
        except RequestEntityTooLarge:
            return respond({'error': 'Request is too large'}, 413)
        except (BadRequest, ValueError):
            return respond({'error': 'Request configuration is invalid'}, 400)
        if not isinstance(payload, dict):
            return respond({'error': 'A JSON object is required'}, 400)
        text_limit = positive_int('MAX_TEXT_CHARACTERS', 50000)
        for field in ['text', 'message', 'events_text', 'case_notes', 'disease']:
            value = payload.get(field)
            if value is not None and (not isinstance(value, str) or len(value) > text_limit):
                return respond({'error': 'Text fields must fit the configured limit'}, 400)
        specialty = payload.get('specialtyId')
        if specialty is not None and (not isinstance(specialty, str)
                                       or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', specialty)):
            return respond({'error': 'Invalid specialty ID'}, 400)
        events = payload.get('events')
        if events is not None and (not isinstance(events, list)
                                   or len(events) > positive_int('MAX_EVENTS', 10)
                                   or any(not isinstance(event, str) or len(event) > text_limit
                                          for event in events)):
            return respond({'error': 'Events must fit the configured list limit'}, 400)
        articles = payload.get('analyzed_articles')
        if articles is not None and (not isinstance(articles, list)
                                     or len(articles) > article_limit()
                                     or any(not isinstance(article, dict) for article in articles)):
            return respond({'error': 'Articles must fit the configured list limit'}, 400)
        if 'userId' in payload and payload['userId'] != uid:
            return respond({'error': 'Chat ownership does not match the signed-in user'}, 403)
        if 'chatId' in payload and (not isinstance(payload['chatId'], str)
                                    or not payload['chatId'] or '/' in payload['chatId']):
            return respond({'error': 'Invalid chat ID'}, 400)
        g.user_id = uid
        g.auth_claims = claims
        return respond(handler(request))

    return guarded
