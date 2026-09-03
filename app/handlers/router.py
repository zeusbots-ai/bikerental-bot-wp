import logging
from typing import Dict, Any, Optional
from app.admin.commands import AdminCommandHandler, is_admin_authorized
from app.handlers.customer_flow import CustomerFlowHandler
from app.services.whatsapp.service import whatsapp_service

logger = logging.getLogger(__name__)

async def route_inbound_message(payload: Dict[str, Any]) -> None:
    """
    Main entry point for messages received from the WhatsApp Web Bridge.
    Routes admin commands to AdminCommandHandler and conversation messages to CustomerFlowHandler.
    """
    sender_phone = payload.get("sender_phone", "")
    body = (payload.get("body") or "").strip()
    has_media = bool(payload.get("has_media"))
    media = payload.get("media")

    clean_phone = "".join(filter(str.isdigit, sender_phone))
    if not clean_phone:
        logger.warning(f"[Router] Received inbound message with empty phone number: {payload}")
        return

    logger.info(f"[Router] Incoming message from {clean_phone}: '{body[:50]}' (has_media={has_media})")

    # Check if message is an admin command (starts with /)
    if body.startswith("/"):
        if await is_admin_authorized(clean_phone):
            response_text = await AdminCommandHandler.handle_command(clean_phone, body)
            await whatsapp_service.send_message(clean_phone, response_text)
            return
        else:
            logger.info(f"[Router] Non-admin {clean_phone} attempted command: {body}")
            # Fallback to customer flow or ignore unauthorized command attempts

    # Route to Customer Interactive Flow
    await CustomerFlowHandler.handle_message(
        sender_phone=clean_phone,
        body=body,
        has_media=has_media,
        media=media
    )
