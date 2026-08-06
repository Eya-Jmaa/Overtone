"""Quick sanity check that Pydantic EmailStr rejects malformed emails."""
import pytest
from pydantic import ValidationError
from services.schemas import SendCodeIn, VerifyCodeIn, LoginIn


VALID_EMAILS = [
    "user@example.com",
    "first.last@sub.domain.co",
    "user+tag@example.org",
    "user@domain.c",
]

INVALID_EMAILS = [
    "invalid-email",
    "no-at-sign.com",
    "a@b",
    "user@.com",
    "user name@example.com",
    "@example.com",
    "user@",
]


@pytest.mark.parametrize("email", VALID_EMAILS)
def test_valid_emails_accepted(email):
    assert SendCodeIn(email=email).email == email
    assert VerifyCodeIn(email=email, code="123456").email == email
    assert LoginIn(email=email, password="secret").email == email


@pytest.mark.parametrize("email", INVALID_EMAILS)
def test_invalid_emails_rejected(email):
    with pytest.raises(ValidationError):
        SendCodeIn(email=email)
    with pytest.raises(ValidationError):
        VerifyCodeIn(email=email, code="123456")
    with pytest.raises(ValidationError):
        LoginIn(email=email, password="secret")                                              
