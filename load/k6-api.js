// AgentFleet API load test (Phase 11, nice-15; auth-token regression fix
// Phase 12 C).
//
// Targets the FastAPI backend directly (not the Next.js web app).
//
// Every /api/v1 route requires a Bearer JWT since Phase 12 B — this script
// predates that and needs a minted token now. Mint one and pass it via
// API_TOKEN (see docs/LOAD_TEST.md "How to run" for the exact one-liner):
//
// Usage:
//   API_TOKEN=<jwt> BASE_URL=http://localhost:8000 k6 run load/k6-api.js          # lists + writes only (no LLM calls)
//   API_TOKEN=<jwt> BASE_URL=http://localhost:8000 CHAT=1 k6 run load/k6-api.js   # also runs the chat_smoke scenario (hits the LLM proxy)
//
// Scenarios:
//   lists       - round-robins GET /agents, /runs, /documents, /schedules. Ramp 0->20 VUs
//                 over 30s, hold 20 VUs for 60s, ramp down over 10s. Checks status 200 and
//                 the X-Total-Count header (added in the pagination work earlier in Phase 11).
//   writes      - constant 5 VUs for 60s POSTing /api/v1/conversations. Exercises a DB write
//                 path without burning LLM tokens (creating a conversation row does not call
//                 the model — only sending a message does).
//   chat_smoke  - opt-in via CHAT=1 env var. 1 VU, 3 iterations. Creates a conversation, then
//                 posts a tiny message and reads the SSE stream to completion. Proves the
//                 real chat path works under k6 without doing a real load run against the LLM.
//
// Rate limiting (Phase 12 C) note: chat send / document upload / the public
// invoke endpoint are limited per-user (30/min, 10/min, 60/min by default —
// RATE_LIMIT_* env on the API). This script's default run (lists + writes)
// never touches any of those three routes, so it is NOT affected by rate
// limiting at all. CHAT=1's chat_smoke scenario sends only 3 messages from
// a single token/VU — well under the 30/minute chat default — so it isn't
// affected either. See docs/LOAD_TEST.md for the live-verified numbers.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const CHAT_ENABLED = __ENV.CHAT === '1';
const API_TOKEN = __ENV.API_TOKEN || '';

// Merged into every request's `headers` object below. Spreading this in
// when API_TOKEN is unset would send `Authorization: Bearer ` (empty) —
// setup() throws before any VU traffic starts in that case anyway, but
// AUTH_HEADERS stays an empty object rather than a broken header either way.
const AUTH_HEADERS = API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};

const LIST_ENDPOINTS = [
  '/api/v1/agents',
  '/api/v1/runs',
  '/api/v1/documents',
  '/api/v1/schedules',
];

export const options = {
  scenarios: {
    lists: {
      executor: 'ramping-vus',
      exec: 'listsScenario',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '60s', target: 20 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
    writes: {
      executor: 'constant-vus',
      exec: 'writesScenario',
      vus: 5,
      duration: '60s',
    },
    ...(CHAT_ENABLED
      ? {
          chat_smoke: {
            executor: 'per-vu-iterations',
            exec: 'chatSmokeScenario',
            vus: 1,
            iterations: 3,
            maxDuration: '3m',
          },
        }
      : {}),
  },
  thresholds: {
    'http_req_duration{scenario:lists}': ['p(95)<300'],
    'http_req_failed{scenario:lists}': ['rate<0.01'],
    'http_req_duration{scenario:writes}': ['p(95)<500'],
  },
};

// setup() runs once before any VU traffic starts, so the writes/chat_smoke
// scenarios get a real agent id instead of a hardcoded one. Also the one
// place API_TOKEN gets validated — fail fast with a clear message rather
// than letting every VU independently discover 401s (Phase 12 B: every
// /api/v1 route is auth-gated now, no exceptions this script touches).
export function setup() {
  if (!API_TOKEN) {
    throw new Error(
      'setup: API_TOKEN is not set. Every /api/v1 route requires a Bearer JWT ' +
        '(Phase 12 B) — mint one and re-run with API_TOKEN=<jwt>. ' +
        'See docs/LOAD_TEST.md "How to run" for the one-liner.'
    );
  }
  const res = http.get(`${BASE_URL}/api/v1/agents`, { headers: AUTH_HEADERS });
  if (res.status !== 200) {
    throw new Error(`setup: GET /api/v1/agents failed with status ${res.status}`);
  }
  const agents = JSON.parse(res.body);
  if (!agents || agents.length === 0) {
    throw new Error('setup: no agents found — seed the DB before load testing');
  }
  return { agentId: agents[0].id };
}

export function listsScenario() {
  const path = LIST_ENDPOINTS[__ITER % LIST_ENDPOINTS.length];
  const res = http.get(`${BASE_URL}${path}`, { headers: AUTH_HEADERS, tags: { name: 'list' } });
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has X-Total-Count header': (r) => r.headers['X-Total-Count'] !== undefined,
  });
}

export function writesScenario(data) {
  const res = http.post(
    `${BASE_URL}/api/v1/conversations`,
    JSON.stringify({ agent_id: data.agentId }),
    {
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      tags: { name: 'create_conversation' },
    }
  );
  check(res, {
    'status is 200/201': (r) => r.status === 200 || r.status === 201,
  });
}

export function chatSmokeScenario(data) {
  const convRes = http.post(
    `${BASE_URL}/api/v1/conversations`,
    JSON.stringify({ agent_id: data.agentId }),
    { headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' } }
  );
  const convOk = check(convRes, {
    'chat_smoke: conversation created': (r) => r.status === 200 || r.status === 201,
  });
  if (!convOk) {
    return;
  }
  const conversation = JSON.parse(convRes.body);

  const msgRes = http.post(
    `${BASE_URL}/api/v1/conversations/${conversation.id}/messages`,
    JSON.stringify({ content: 'Reply with the word OK.' }),
    {
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      timeout: '60s', // generous: this hits the LLM proxy and streams a full SSE response
    }
  );
  check(msgRes, {
    'chat_smoke: SSE stream completed with 200': (r) => r.status === 200,
    'chat_smoke: stream body has SSE data frames': (r) => r.body && r.body.includes('data:'),
  });

  sleep(1);
}
