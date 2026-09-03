import logging
import httpx
from typing import Dict, Any, Optional
from app.config import settings
from app.services.whatsapp.base import WhatsAppClientInterface

logger = logging.getLogger(__name__)

class WhatsAppBridgeClient(WhatsAppClientInterface):
    """
    Communicates with the local Node.js whatsapp-web.js bridge microservice.
    """

    def __init__(self, base_url: str = None):
        self.base_url = (base_url or settings.BRIDGE_URL).rstrip("/")
        self.client = httpx.AsyncClient(timeout=30.0)

    async def send_text_message(self, to: str, message: str) -> bool:
        clean_to = "".join(filter(str.isdigit, str(to)))
        url = f"{self.base_url}/send-message"
        try:
            resp = await self.client.post(url, json={"to": clean_to, "message": message})
            if resp.status_code == 200:
                return True
            logger.error(f"[BridgeClient] Failed to send message to {clean_to}. Status: {resp.status_code}, Body: {resp.text}")
            return False
        except Exception as e:
            logger.error(f"[BridgeClient] Exception sending message to {clean_to}: {e}")
            return False

    async def send_media_message(
        self,
        to: str,
        file_path: str,
        caption: str = "",
        mime_type: Optional[str] = None
    ) -> bool:
        clean_to = "".join(filter(str.isdigit, str(to)))
        url = f"{self.base_url}/send-media"
        payload = {
            "to": clean_to,
            "filePath": file_path,
            "caption": caption,
            "mimetype": mime_type
        }
        try:
            resp = await self.client.post(url, json=payload)
            if resp.status_code == 200:
                return True
            logger.error(f"[BridgeClient] Failed to send media to {clean_to}. Status: {resp.status_code}, Body: {resp.text}")
            return False
        except Exception as e:
            logger.error(f"[BridgeClient] Exception sending media to {clean_to}: {e}")
            return False

    async def get_status(self) -> Dict[str, Any]:
        url = f"{self.base_url}/status"
        try:
            resp = await self.client.get(url, timeout=5.0)
            if resp.status_code == 200:
                return resp.json()
            return {"status": "ERROR", "statusCode": resp.status_code}
        except Exception as e:
            return {"status": "UNREACHABLE", "error": str(e)}

    async def get_qr_data(self) -> Dict[str, Any]:
        url = f"{self.base_url}/qr-data"
        try:
            resp = await self.client.get(url, timeout=5.0)
            if resp.status_code == 200:
                return resp.json()
            return {"status": "ERROR", "raw": None, "dataUrl": None}
        except Exception as e:
            return {"status": "UNREACHABLE", "error": str(e), "raw": None, "dataUrl": None}

    async def close(self):
        await self.client.aclose()
