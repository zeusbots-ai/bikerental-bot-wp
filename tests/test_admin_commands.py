import unittest
from unittest.mock import patch, AsyncMock
from app.admin.commands import is_admin_authorized, AdminCommandHandler

class TestAdminCommands(unittest.IsolatedAsyncioTestCase):

    async def test_admin_authorization(self):
        # 919876543210 is in settings.admin_phone_list
        authorized = await is_admin_authorized("919876543210")
        self.assertTrue(authorized)

        # Formats with + or spaces should also be handled cleanly
        authorized_with_plus = await is_admin_authorized("+91 9876543210")
        self.assertTrue(authorized_with_plus)

        # Random user phone should not be authorized
        unauthorized = await is_admin_authorized("919999999999")
        self.assertFalse(unauthorized)

    async def test_unauthorized_command_execution(self):
        response = await AdminCommandHandler.handle_command("919999999999", "/status")
        self.assertIn("Unauthorized", response)

    async def test_help_command(self):
        response = await AdminCommandHandler.handle_command("919876543210", "/help")
        self.assertIn("Admin Command Center", response)
        self.assertIn("/start", response)
        self.assertIn("/end", response)
        self.assertIn("/approve", response)
        self.assertIn("/reject", response)

if __name__ == "__main__":
    unittest.main()
