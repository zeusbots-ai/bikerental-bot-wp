import secrets
import string
from datetime import datetime, timezone

def _generate_random_suffix(length: int = 4) -> str:
    alphabet = string.ascii_uppercase + string.digits
    # Remove ambiguous characters like 0, O, 1, I
    clean_alphabet = "".join([c for c in alphabet if c not in "0O1I"])
    return "".join(secrets.choice(clean_alphabet) for _ in range(length))

def generate_verification_id() -> str:
    """Format: VER-YYYYMMDD-XXXX"""
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"VER-{date_str}-{_generate_random_suffix(4)}"

def generate_order_id() -> str:
    """Format: ORD-YYYYMMDD-XXXX"""
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"ORD-{date_str}-{_generate_random_suffix(4)}"

def generate_payment_id() -> str:
    """Format: PAY-YYYYMMDD-XXXX"""
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"PAY-{date_str}-{_generate_random_suffix(4)}"

def generate_log_id() -> str:
    """Format: LOG-YYYYMMDD-XXXX"""
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"LOG-{date_str}-{_generate_random_suffix(4)}"
