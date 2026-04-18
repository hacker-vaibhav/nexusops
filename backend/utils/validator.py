"""
Infrastructure Request Validator
─────────────────────────────────
3-tier output:
  VALID      → plan generation proceeds
  INVALID    → contradictory / destructive / non-infra request
  INCOMPLETE → infra intent clear but critical info missing

Catches semantic contradictions like:
  "deploy EC2 but no compute resources"   → INVALID
  "create S3 but don't use any storage"   → INVALID
  "deploy service and delete all buckets" → INVALID
  "spin up something"                     → INCOMPLETE
  "manasa wants chocolate"                → INVALID
"""

import re
from dataclasses import dataclass, field
from typing import Optional

# ── Contradiction pairs ───────────────────────────────────────────────────
# (trigger_words, negation_context) → detected as contradiction
CONTRADICTIONS = [
    # Compute contradictions
    {
        "requires":  ["ec2", "instance", "compute", "vm", "server", "vcpu", "cpu"],
        "negates":   ["no compute", "without compute", "don't create.*compute",
                      "do not create.*compute", "no.*instance", "without.*instance",
                      "no server", "without server", "skip compute", "no ec2",
                      "without ec2", "don't.*ec2", "do not.*ec2"],
        "error":     "Contradiction: you requested EC2/compute but also said not to create compute resources.",
        "suggestion":"Remove the compute resource or remove the constraint. Example: 'Deploy web-app with S3 bucket and EC2 t2.medium on port 80'",
    },
    # Storage contradictions
    {
        "requires":  ["s3", "bucket", "storage", "object store"],
        "negates":   ["no storage", "without storage", "no s3", "without s3",
                      "no bucket", "without bucket", "don't create.*storage",
                      "do not create.*storage", "skip storage"],
        "error":     "Contradiction: you requested S3/storage but also said not to create storage.",
        "suggestion":"Remove the storage resource or remove the constraint.",
    },
    # Deploy contradictions
    {
        "requires":  ["deploy", "container", "docker", "service"],
        "negates":   ["no deploy", "without deploying", "don't deploy",
                      "do not deploy", "skip deploy", "no container"],
        "error":     "Contradiction: you asked to deploy a service but also said not to deploy.",
        "suggestion":"Clarify what you want to provision. Example: 'Set up EC2 instance and S3 bucket for payments-api'",
    },
]

# ── Destructive / dangerous patterns ─────────────────────────────────────
DANGEROUS_PATTERNS = [
    (r"\bdelete\s+all\b",          "Destructive: 'delete all' is not permitted."),
    (r"\bdrop\s+(all|database|table|bucket)\b", "Destructive: drop operations blocked."),
    (r"\bterminate\s+all\b",       "Destructive: 'terminate all' is not permitted."),
    (r"\bwipe\b",                  "Destructive: wipe operations blocked."),
    (r"\brm\s+-rf\b",              "Dangerous shell command detected."),
    (r"\bsudo\s+rm\b",             "Dangerous shell command detected."),
    (r"[;&|`]\s*rm\b",             "Shell injection detected."),
    (r"\bexfiltrate\b",            "Security: data exfiltration not permitted."),
    (r"<script",                   "Security: script injection detected."),
    (r"javascript:",               "Security: script injection detected."),
    (r"\bexploit\b",               "Security: exploit attempts blocked."),
    (r"(delete|destroy|remove)\s+(all|every|each)",  "Destructive: bulk delete not permitted."),
]

# ── Non-infrastructure indicators ─────────────────────────────────────────
PERSONAL_PATTERNS = [
    r"\b(she|he)\s+(wants|needs|likes|loves)\b",
    r"\bgood\s+(girl|boy|person|student)\b",
    r"\b(chocolate|food|grocery|pizza|cake|coffee)\b",
    r"\b(birthday|party|wedding|holiday)\b",
    r"\bhow\s+are\s+you\b",
    r"\bhi\b|\bhello\b|\bhey\b",
    r"\bthank\s+you\b|\bthanks\b",
    r"\bi\s+(love|hate|like|miss)\b",
    r"\bmy\s+(friend|mom|dad|sister|brother|teacher)\b",
]

# ── Infrastructure vocabulary ─────────────────────────────────────────────
INFRA_VERBS = {
    "deploy", "set up", "setup", "provision", "create", "build", "launch",
    "spin up", "start", "run", "host", "serve", "configure", "install",
    "initialise", "initialize", "bring up", "stand up", "bootstrap"
}

INFRA_RESOURCES = {
    "ec2","instance","server","compute","vm","virtual machine","node",
    "container","docker","pod","kubernetes","k8s",
    "s3","bucket","storage","volume","database","db",
    "service","api","endpoint","microservice","app","application",
    "web","frontend","backend","pipeline","worker",
    "environment","env","prod","production","staging","dev","development",
    "port","region","cpu","memory","ram","gb","mb","t2","t3",
}

# ── Vagueness indicators (→ INCOMPLETE) ──────────────────────────────────
VAGUE_PHRASES = [
    r"\bsomething\s+(scalable|fast|good|nice|simple|basic)\b",
    r"\bsome\s+(server|thing|service|infra)\b",
    r"\bidk\b|\bnot\s+sure\b",
    r"^\s*(deploy|set up|provision)\s+(something|a thing|it|this)\s*\.?\s*$",
]


@dataclass
class ValidationResult:
    status: str                              # "VALID" | "INVALID" | "INCOMPLETE"
    error:  Optional[str] = None
    suggestion: Optional[str] = None
    extracted:  Optional[dict] = field(default_factory=dict)
    confidence: float = 0.0

    @property
    def valid(self) -> bool:
        return self.status == "VALID"

    @property
    def rejection_reason(self) -> Optional[str]:
        return self.error


def validate_ticket(text: str) -> ValidationResult:
    """
    Full semantic validation. Returns VALID, INVALID, or INCOMPLETE.
    """
    if not text or not text.strip():
        return ValidationResult(
            status="INVALID",
            error="Empty ticket submitted.",
            suggestion="Describe the infrastructure you want to deploy.",
        )

    t = text.lower().strip()
    words = t.split()

    # ── 1. Too short ──────────────────────────────────────────────────────
    if len(words) < 4:
        return ValidationResult(
            status="INCOMPLETE",
            error="Ticket is too short to determine intent.",
            suggestion=(
                "Example: 'Set up production environment for payments-api with "
                "S3 bucket, t2.medium EC2 instance, port 8080'"
            ),
        )

    # ── 2. Dangerous / destructive ────────────────────────────────────────
    for pattern, reason in DANGEROUS_PATTERNS:
        if re.search(pattern, t):
            return ValidationResult(
                status="INVALID",
                error=reason,
                suggestion="NEXUS OPS only provisions and deploys resources. "
                           "Destructive operations are not permitted.",
            )

    # ── 3. Non-infrastructure text ────────────────────────────────────────
    personal_hits = sum(1 for p in PERSONAL_PATTERNS if re.search(p, t))
    if personal_hits >= 1:
        verb_hits = sum(1 for v in INFRA_VERBS if v in t)
        resource_hits = sum(1 for r in INFRA_RESOURCES if r in t)
        if verb_hits + resource_hits < 3:
            return ValidationResult(
                status="INCOMPLETE",
                error="This looks like a general message, not an infrastructure request.",
                suggestion=(
                    "Try: 'Deploy auth-service with S3 storage and EC2 t2.medium on port 3000'"
                ),
            )

    # ── 4. Semantic contradiction detection ───────────────────────────────
    contradiction = _detect_contradiction(t)
    if contradiction:
        return ValidationResult(
            status="INVALID",
            error=contradiction["error"],
            suggestion=contradiction["suggestion"],
        )

    # ── 5. Vagueness check (→ INCOMPLETE) ────────────────────────────────
    for vague in VAGUE_PHRASES:
        if re.search(vague, t):
            return ValidationResult(
                status="INCOMPLETE",
                error="Request is too vague to generate a reliable execution plan.",
                suggestion=(
                    "Specify: service name, resource type, instance size, and port. "
                    "Example: 'Deploy ml-api with S3 bucket, t2.large EC2, port 5000'"
                ),
            )

    # ── 6. Infrastructure confidence score ────────────────────────────────
    verb_hits     = sum(1 for v in INFRA_VERBS if v in t)
    resource_hits = sum(1 for r in INFRA_RESOURCES if r in t)
    score         = (verb_hits * 0.4) + (resource_hits * 0.5)
    confidence    = min(score / 3.0, 1.0)

    if confidence < 0.15:
        missing = []
        if verb_hits == 0:
            missing.append("an action (e.g. 'deploy', 'set up', 'provision')")
        if resource_hits == 0:
            missing.append("a resource type (e.g. 'EC2', 'S3', 'container', 'service')")
        return ValidationResult(
            status="INCOMPLETE",
            error=f"Missing infrastructure context: {' and '.join(missing) if missing else 'infrastructure keywords'}.",
            suggestion=(
                "Example: 'Set up staging environment for auth-service with "
                "S3 bucket, t2.medium compute, deploy container on port 3000'"
            ),
        )

    # ── 7. Extract preview params ─────────────────────────────────────────
    extracted = _extract_params(t)

    # Valid but slightly ambiguous
    suggestion = None
    if confidence < 0.4:
        suggestion = (
            "Request is somewhat ambiguous — defaults will be used "
            "(region: us-east-1, instance: t2.medium, port: 8080)."
        )

    return ValidationResult(
        status="VALID",
        confidence=confidence,
        extracted=extracted,
        suggestion=suggestion,
    )


def _detect_contradiction(text: str) -> Optional[dict]:
    """
    Checks whether a request simultaneously requires and forbids
    the same type of resource.
    """
    for pair in CONTRADICTIONS:
        # Does the text mention the required resource?
        requires_hit = any(kw in text for kw in pair["requires"])
        if not requires_hit:
            continue

        # Does the text also negate / forbid it?
        for neg_pattern in pair["negates"]:
            if re.search(neg_pattern, text):
                return {"error": pair["error"], "suggestion": pair["suggestion"]}

    # Generic "X but not X" pattern
    but_not = re.search(
        r'(deploy|use|create|provision|set up)\s+(.+?)\s+but\s+'
        r'(do not|don\'t|without|no)\s+(create|use|provision)?\s*\2',
        text
    )
    if but_not:
        return {
            "error": f"Contradiction detected: '{but_not.group(0)}'",
            "suggestion": "Remove the conflicting constraint from your ticket.",
        }

    return None


def _extract_params(text: str) -> dict:
    params = {}
    pm = re.search(r'\bport\s+(\d{2,5})\b', text)
    if pm:
        params["port"] = int(pm.group(1))
    im = re.search(r'\b(t[23]\.(nano|micro|small|medium|large|xlarge))\b', text)
    if im:
        params["instance_type"] = im.group(1)
    rm = re.search(r'\b(us-east-[12]|us-west-[12]|eu-west-[123]|ap-south-1)\b', text)
    if rm:
        params["region"] = rm.group(1)
    if any(w in text for w in ["production", " prod "]):
        params["environment"] = "production"
    elif "staging" in text:
        params["environment"] = "staging"
    elif any(w in text for w in ["development", " dev "]):
        params["environment"] = "development"
    return params
