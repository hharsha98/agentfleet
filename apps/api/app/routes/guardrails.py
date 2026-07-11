"""Guardrails sandbox: pure-function prompt-injection scan + PII masking.

Mounted at /api/v1/guardrails — see app/main.py. No DB, no LLM: this just
exposes services/guardrails.py over HTTP for the web "try it" panel and is
trivially unit-testable (see tests/test_guardrails.py).
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.guardrails import mask_pii, scan_tool_output

router = APIRouter()


class GuardrailScanIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


class PiiResult(BaseModel):
    masked: str
    replacements: int


class GuardrailScanOut(BaseModel):
    injection_flags: list[str]
    pii: PiiResult


@router.post("/scan", response_model=GuardrailScanOut)
async def scan(payload: GuardrailScanIn) -> GuardrailScanOut:
    flags = scan_tool_output(payload.text)
    masked, replacements = mask_pii(payload.text)
    return GuardrailScanOut(
        injection_flags=flags,
        pii=PiiResult(masked=masked, replacements=replacements),
    )
