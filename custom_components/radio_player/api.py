"""Zugriff auf die Fernbedienungs-Schnittstelle des Radios (dieselbe wie für die Handy-Fernbedienung)."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

PORTS = (80, 8080, 8000)  # Reihenfolge wie beim Radio selbst


class RadioError(Exception):
    """Radio nicht erreichbar oder Befehl abgelehnt."""


class RadioAuthError(RadioError):
    """Schlüssel, PIN oder Code abgelehnt."""


class RadioApi:
    def __init__(self, session: aiohttp.ClientSession, host: str, client_id: str, key: str = "", admin_pin: str = "") -> None:
        self.session = session
        self.host = host
        self.client_id = client_id
        self.key = key
        self.admin_pin = admin_pin
        self._admin_token = ""

    async def _call(self, method: str, path: str, body: dict | None = None) -> Any:
        headers = {
            "x-key": self.key,
            "x-client": self.client_id,
            "x-kind": "phone",
            "x-name": "Home%20Assistant",
            "x-admin": self._admin_token,
        }
        try:
            async with self.session.request(
                method, f"http://{self.host}{path}", json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=10)
            ) as res:
                data = await res.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as err:
            raise RadioError(f"Radio unter {self.host} nicht erreichbar: {err}") from err
        if res.status == 403:
            raise RadioAuthError(data.get("error", "Zugang abgelehnt."))
        if res.status >= 400:
            raise RadioError(data.get("error", f"HTTP {res.status}"))
        return data

    async def room(self) -> dict:
        """Name und Version – geht ohne Schlüssel. Ohne Port werden die üblichen Ports probiert."""
        if ":" in self.host:
            return await self._call("GET", "/api/room")
        base = self.host
        for port in PORTS:
            self.host = base if port == 80 else f"{base}:{port}"
            try:
                info = await self._call("GET", "/api/room")
            except RadioError:
                continue
            if info.get("app") == "radio":
                return info
        self.host = base
        raise RadioError(f"Unter {base} läuft kein Radio mit Fernbedienung.")

    async def join(self, pin: str | None = None, request_code: bool = False) -> None:
        """Holt den Geräteschlüssel. Im sicheren Modus mit Join-PIN oder dem Einmalcode vom Radio."""
        body: dict[str, Any] = {"clientId": self.client_id, "name": "Home Assistant"}
        if request_code:
            body["request"] = True
        if pin:
            body["pin"] = pin
            body["code"] = pin
        data = await self._call("POST", "/api/join", body)
        if data.get("key"):
            self.key = data["key"]

    async def login(self) -> None:
        """Admin-Anmeldung – das Token gilt bis zum Neustart des Radios."""
        data = await self._call("POST", "/api/admin", {"pin": self.admin_pin})
        self._admin_token = data["token"]

    async def state(self) -> dict:
        return await self._call("GET", "/api/state")

    async def command(self, action: str, value: Any = None) -> None:
        try:
            await self._call("POST", "/api/command", {"action": action, "value": value})
        except RadioAuthError:
            # Admin-Token nach Neustart des Radios abgelaufen: einmal neu anmelden
            if not self.admin_pin:
                raise
            await self.login()
            await self._call("POST", "/api/command", {"action": action, "value": value})
