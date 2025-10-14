import os
import datetime
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from email_service import DemoEmailService  # Assuming this exists in backend

logger = logging.getLogger(__name__)

DEFAULT_FROM_EMAIL = getattr(os.environ, 'DEFAULT_FROM_EMAIL', 'no-reply@example.com')
EMAIL_HOST = getattr(os.environ, 'EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(getattr(os.environ, 'EMAIL_PORT', 587))
EMAIL_HOST_USER = getattr(os.environ, 'EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = getattr(os.environ, 'EMAIL_HOST_PASSWORD', '')

class GoogleCalendarService:
    def __init__(self):
        self.scopes = ['https://www.googleapis.com/auth/calendar']
        self.calendar_id = os.environ.get('GOOGLE_CALENDAR_ID', 'primary')
        self.credentials_path = os.environ.get('GOOGLE_CREDENTIALS_FILE', None)
        self.token_path = os.environ.get('GOOGLE_TOKEN_FILE', None)
        
        if not self.credentials_path or not os.path.exists(self.credentials_path):
            logger.error(f"Google credentials file not found: {self.credentials_path}")
            self.service = None
        else:
            self.service = self._authenticate()

    def _authenticate(self):
        """Authenticate with Google Calendar API using OAuth2"""
        if not self.credentials_path or not os.path.exists(self.credentials_path):
            logger.error(f"Credentials file not found at: {self.credentials_path}")
            return None
        
        creds = None
        
        if os.path.exists(self.token_path):
            try:
                creds = Credentials.from_authorized_user_file(self.token_path, self.scopes)
            except Exception as e:
                logger.error(f"Error loading credentials: {e}")
        
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                except Exception as e:
                    logger.error(f"Error refreshing credentials: {e}")
                    creds = None
            
            if not creds:
                try:
                    flow = InstalledAppFlow.from_client_secrets_file(
                        self.credentials_path, self.scopes
                    )
                    creds = flow.run_local_server(port=0)
                    
                    with open(self.token_path, 'w') as token:
                        token.write(creds.to_json())
                except Exception as e:
                    logger.error(f"Error during OAuth flow: {e}")
                    return None
        
        try:
            service = build('calendar', 'v3', credentials=creds)
            logger.info("✅ Google Calendar service authenticated successfully")
            return service
        except Exception as e:
            logger.error(f"Failed to build calendar service: {e}")
            return None

    def create_demo_event(self, demo_booking):
        """Create a calendar event with Google Meet link (UTC datetime only)"""
        if not self.service:
            logger.error("Google Calendar service not authenticated")
            return None

        try:
            start_utc = demo_booking.demo_date
            if start_utc.tzinfo is None:
                start_utc = start_utc.replace(tzinfo=datetime.timezone.utc)
            end_utc = start_utc + datetime.timedelta(minutes=demo_booking.duration_minutes)

            event_body = {
                'summary': f'Demo Session - {demo_booking.name}',
                'description': f"""
                Demo Session Details:

                Name: {demo_booking.name}
                Email: {demo_booking.email}
                Company: {demo_booking.company or 'N/A'}
                Phone: {demo_booking.phone or 'N/A'}

                Message: {demo_booking.message or 'No additional message'}
                """.strip(),
                'start': {'dateTime': start_utc.isoformat(), 'timeZone': 'UTC'},
                'end': {'dateTime': end_utc.isoformat(), 'timeZone': 'UTC'},
                'attendees': [
                    {'email': demo_booking.email, 'displayName': demo_booking.name},
                    {'email': os.environ.get('DEMO_HOST_EMAIL', DEFAULT_FROM_EMAIL)}
                ],
                'conferenceData': {
                    'createRequest': {
                        'requestId': f"demo_{demo_booking.id}_{int(datetime.datetime.now().timestamp())}",
                        'conferenceSolutionKey': {'type': 'hangoutsMeet'},
                    },
                },
                'reminders': {
                    'useDefault': False,
                    'overrides': [
                        {'method': 'email', 'minutes': 24 * 60},
                        {'method': 'email', 'minutes': 60},
                        {'method': 'popup', 'minutes': 15},
                    ],
                },
                'guestsCanSeeOtherGuests': False,
                'guestsCanInviteOthers': False,
                'sendUpdates': 'all'
            }

            event = self.service.events().insert(
                calendarId=self.calendar_id,
                body=event_body,
                conferenceDataVersion=1,
                sendUpdates='all'
            ).execute()

            meet_link = event['conferenceData']['entryPoints'][0]['uri']
            event_link = event.get('htmlLink')
            event_id = event.get('id')

            demo_booking.meet_link = meet_link
            demo_booking.calendar_link = event_link
            demo_booking.event_id = event_id

            email_service = DemoEmailService()
            email_service.send_demo_confirmation(demo_booking)

            return {
                'event_id': event_id,
                'meet_link': meet_link,
                'calendar_link': event_link,
                'event': event
            }

        except Exception as e:
            logger.error(f"❌ Failed to create calendar event: {e}")
            return None

    def send_smtp_email(self, to_email, subject, body, demo_booking=None):
        """Send email using Gmail SMTP with optional demo template"""
        if demo_booking:
            email_service = DemoEmailService()
            return email_service.send_demo_confirmation(demo_booking)
        
        msg = MIMEMultipart()
        msg['From'] = DEFAULT_FROM_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'html'))

        try:
            with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as server:
                server.starttls()
                server.login(EMAIL_HOST_USER, EMAIL_HOST_PASSWORD)
                server.sendmail(DEFAULT_FROM_EMAIL, to_email, msg.as_string())
            logger.info(f"📧 Email sent to {to_email}")
            return True
        except Exception as e:
            logger.error(f"❌ Error sending email: {e}")
            return False

    def update_event(self, event_id, demo_booking):
        """Update an existing calendar event"""
        try:
            event = self.service.events().get(calendarId=self.calendar_id, eventId=event_id).execute()
            
            end_time = demo_booking.demo_date + datetime.timedelta(minutes=demo_booking.duration_minutes)
            
            event['summary'] = f'Demo Session - {demo_booking.name}'
            event['start']['dateTime'] = demo_booking.demo_date.isoformat()
            event['end']['dateTime'] = end_time.isoformat()
            
            updated_event = self.service.events().update(
                calendarId=self.calendar_id,
                eventId=event_id,
                body=event,
                sendUpdates='all'
            ).execute()
            
            return updated_event
            
        except Exception as e:
            logger.error(f"Failed to update calendar event: {e}")
            return None
    
    def cancel_event(self, event_id):
        """Cancel a calendar event"""
        try:
            self.service.events().delete(calendarId=self.calendar_id, eventId=event_id, sendUpdates='all').execute()
            logger.info(f"Cancelled calendar event: {event_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to cancel calendar event: {e}")
            return False
