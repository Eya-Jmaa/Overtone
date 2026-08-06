import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from config import settings


def send_code_email(to_email: str, code: str):
    formatted = f"{code[:3]} {code[3:]}"

    html = f"""
    <!DOCTYPE html>
    <html>
      <body style="margin:0;padding:40px 20px;background:#0a0b10;font-family:-apple-system,sans-serif;">
        <div style="max-width:440px;margin:0 auto;background:#13151c;border:1px solid #2a2e3d;border-radius:8px;padding:40px 32px;">
          <div style="font-family:Georgia,serif;font-size:24px;color:#f5f1e8;letter-spacing:-0.5px;margin-bottom:8px;">
            Solace<span style="color:#d4a574;">.</span>
          </div>
          <p style="color:#a8a294;font-size:11px;margin:0 0 32px 0;letter-spacing:2px;text-transform:uppercase;font-family:monospace;">
            Your verification code
          </p>
          <h1 style="color:#f5f1e8;font-family:Georgia,serif;font-weight:normal;font-size:22px;line-height:1.3;margin:0 0 24px 0;">
            Enter this code to continue.
          </h1>
          <div style="background:#0a0b10;border:1px solid #2a2e3d;border-radius:6px;padding:24px;text-align:center;margin:0 0 24px 0;">
            <div style="font-family:'JetBrains Mono', Courier, monospace;font-size:36px;letter-spacing:10px;color:#d4a574;font-weight:500;">
              {formatted}
            </div>
          </div>
          <p style="color:#a8a294;font-size:13px;line-height:1.6;margin:0 0 16px 0;">
            This code expires in 10 minutes. Don't share it with anyone.
          </p>
          <p style="color:#6b6759;font-size:11px;border-top:1px solid #2a2e3d;padding-top:16px;margin-top:24px;">
            If you didn't request this code, you can safely ignore this email.
          </p>
        </div>
      </body>
    </html>
    """

    sender = settings.email_from or settings.gmail_user

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Your code: {formatted}"
    msg["From"] = f"Solace <{sender}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html, "html"))

    print(f"[email] Sending to: {to_email} | From: {sender}")
    # Without a timeout a stalled connection to Gmail hangs the request thread
    # indefinitely, and enough of those exhaust the threadpool serving every
    # other sync endpoint.
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=settings.email_timeout_seconds) as server:
        server.ehlo()
        server.starttls()
        server.login(settings.gmail_user, settings.gmail_app_password)
        server.sendmail(sender, to_email, msg.as_string())
    print(f"[email] Sent successfully to {to_email}")
