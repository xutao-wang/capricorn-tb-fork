# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from html import escape
import os

import functions_framework
from flask import jsonify
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, To

from capricorn_runtime.security import protected_http


@functions_framework.http
@protected_http
def send_feedback_email(request):
    """Send only to operator-configured recipients after explicit enablement."""
    sender = os.environ.get('FEEDBACK_FROM_EMAIL', '')
    recipients = [value.strip() for value in os.environ.get('FEEDBACK_TO_EMAILS', '').split(',')
                  if value.strip()]
    api_key = os.environ.get('SENDGRID_API_KEY')
    if (os.environ.get('FEEDBACK_ENABLED', 'false').lower() != 'true'
            or not sender or not recipients or not api_key):
        return jsonify({'error': 'Feedback email is not configured'}), 503

    payload = request.get_json()
    feedback = payload.get('feedback')
    name = payload.get('name', 'Capricorn user')
    email = payload.get('email', '')
    if (not isinstance(feedback, str) or not feedback.strip() or len(feedback) > 5000
            or not isinstance(name, str) or len(name) > 200
            or not isinstance(email, str) or len(email) > 320):
        return jsonify({'error': 'Valid feedback text is required'}), 400
    message = Mail(
        from_email=sender,
        to_emails=[To(email=recipient) for recipient in recipients],
        subject='Capricorn Medical Research App Feedback',
        html_content=(f'<p>From: {escape(name)}</p><p>Email: {escape(email)}</p>'
                      f'<p>{escape(feedback)}</p>'),
    )
    try:
        response = SendGridAPIClient(api_key).send(message)
        if not 200 <= response.status_code < 300:
            return jsonify({'error': 'Feedback delivery failed'}), 502
        return jsonify({'success': True}), 200
    except Exception:
        return jsonify({'error': 'Feedback delivery failed'}), 502
