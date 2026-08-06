# Paramount Intelligence — Adviser Admin Portal Guide

**Audience:** Paramount operators who manage Jackie (the Commercial Adviser)  
**Portal URL:** `/admin` (same app as chat; light “backstage” theme)  
**Last updated:** August 2026

This guide explains every admin-portal function: what it is for, how to use it, what happens when you act, and the rules that keep the adviser safe.

---

## 1. What this portal is

The **Adviser admin** portal (“Portal B”) is the backstage console for Jackie. It is separate from:

| System | Who uses it | Purpose |
|--------|-------------|---------|
| **Chat / voice** (`/chat`, `/voice`) | Org users (e.g. Catalant reps) | Talk to Jackie |
| **Adviser admin** (`/admin`) | Paramount operators | Configure Jackie, orgs, content |
| **Marketing-site Admin** | Website CMS (if used) | **Not** this portal — different accounts |

Use this portal to:

1. Control how Jackie talks (prompts & guardrails)
2. Review real conversations (transcripts)
3. Watch usage and estimated cost
4. Issue and manage partner organization credentials
5. Maintain case studies Jackie can cite
6. Attach case materials (one-pagers, decks, demos)
7. Add company knowledge Jackie can state without a case citation

---

## 2. Getting in

### 2.1 Login

1. Open `/admin/login`.
2. Enter your **admin email** and **password**.
3. On success you land on the **Adviser admin** dashboard (`/admin`).

Sessions last **8 hours** (httpOnly cookie). After expiry, log in again.

Wrong email/password returns a generic “Invalid credentials” message (no hint whether the email exists).

### 2.2 Logout

Use **Logout** in the top-right of the dashboard (or any page that shows it). That ends the admin session and returns you to `/admin/login`.

### 2.3 Who can access

Only people listed as **Adviser admins** (created by engineering via CLI, not from this UI):

```bash
npm run admin:create -- "Full Name" "email@paramountintelligence.co"
```

Password is shown **once** at creation. To reset:

```bash
npm run admin:reset
```

- All signed-in admins currently have the **same full access** (role badge is informational only).
- If an admin account is marked inactive, access stops on the next request.

---

## 3. Dashboard (home)

**Path:** `/admin`

After login you see seven cards:

| Card | Goes to | What you do there |
|------|---------|-------------------|
| **Prompts** | `/admin/prompts` | Edit/publish how Jackie behaves |
| **Transcripts** | `/admin/transcripts` | Read user conversations |
| **Usage** | `/admin/usage` | Volume, caps, estimated cost |
| **Organizations** | `/admin/orgs` | Partner credentials & limits |
| **Cases** | `/admin/cases` | Edit case study data |
| **Case assets** | `/admin/assets` | Upload materials / generate one-pagers |
| **Knowledge** | `/admin/knowledge` | Company info for uncited answers |

Each subpage has a **← Dashboard** (or **← Transcripts**) link to return. There is no persistent sidebar.

> Note: The dashboard may still show a short “portal shell / next slices” line of copy. All seven sections above are live.

---

## 4. Prompts — how Jackie’s instructions work

**Path:** `/admin/prompts`

### 4.1 The four layers (important mental model)

Jackie builds her system prompt from **four layers**, in order:

| Layer | Editable here? | Role |
|-------|----------------|------|
| **1 — Base** | Yes | Core identity, tools, retrieval habits |
| **2 — Guidelines** | Yes | Tone, commercial emphasis, how to talk |
| **3 — Case index** | **No** (auto) | Compact index of case titles/tech from the Cases table |
| **4 — Hard guardrails** | Yes | Safety / non-negotiable rules — **always last** |

**Rule of precedence:** If Guidelines say one thing and Guardrails say another, **Guardrails win** (they are appended last). Code-level gates (pricing, contacts, case citations, founder grounding) also override prompt text.

### 4.2 Day-to-day workflow

1. Open **Prompts**.
2. Choose a tab: **Base**, **Guidelines**, or **Guardrails**.
3. Read the **LIVE** banner (current published version), or the amber notice if nothing is live yet.
4. Edit the body (and optional label, e.g. `added PE emphasis`).
5. Click **Save as draft** — this does **not** change the live agent yet.
6. Optionally click **Preview assembled prompt** to see all four layers labeled in a modal.
7. In **Version history**, find your draft → **Publish** (with confirmation).
8. The agent’s **next reply** uses the newly published text.

### 4.3 Editing an older version

Use **Edit as new version** on a history row. That loads the old text into the editor; saving creates a **new** draft (history is never deleted).

### 4.4 Rollback

Publish an older version from history. That older version becomes LIVE again. Nothing is permanently erased.

### 4.5 Guardrails safety

When the Guardrails tab is active:

- An amber **Safety layer** warning explains that edits change the agent’s hard rules.
- Publishing requires acknowledging that you understand the impact.

Treat Guardrails changes as high-risk. Prefer small, reviewed edits.

### 4.6 What prompts cannot override

Even if you write it in Guidelines, the product will still enforce (in code):

- Case claims need valid `[[case:ID]]` citations from retrieval
- Commercial pricing / contact / founder–company grounding gates
- Tool authorization (e.g. lead capture only when the user asked for a handoff)

Do not rely on prompt wording alone for safety.

---

## 5. Transcripts — reviewing conversations

**Path:** `/admin/transcripts`  
**Detail:** `/admin/transcripts/[conversationId]`

### 5.1 List view

- Filter by **organization**.
- Search by user email, name, or message text.
- Paginated (**25** conversations per page).
- Soft-deleted chats may show a **Deleted** badge (users removed them from their sidebar; admins can still review).

Click a row to open the full transcript.

### 5.2 Detail view

You typically see:

- User name / email and organization
- Full turn history (user + assistant)
- Assistant replies rendered as markdown
- Tools used, token counts, ratings (when present)
- Cited cases resolved to titles (and site links when available)

Transcripts are **read-only**. You cannot edit or delete messages from the admin UI.

### 5.3 How to use this in practice

| Situation | What to do |
|-----------|------------|
| Partner reports a bad answer | Find the org → search email/topic → open detail → note tools + citations |
| Lead / handoff audit | Search for meeting / follow-up language; confirm whether capture ran |
| Prompt canary | After publishing a prompt change, run a test chat and inspect the transcript |

---

## 6. Usage — volume, caps, and estimated cost

**Path:** `/admin/usage`

### 6.1 What you see

1. Choose range: **Last 7 / 30 / 90 days**.
2. **Headline KPIs:** messages, tokens (in/out), TTS characters, STT seconds, estimated USD, active orgs/users.
3. **Today vs caps** per org — progress bars for:
   - Messages / day
   - Claude tokens / day
   - TTS characters / day
   - STT seconds / day  
   Bars turn amber near the cap (~80%+) and red at/over the cap.
4. Daily message trend chart.
5. Expand an org for **per-user** breakdown (sortable).

### 6.2 How to read cost

Dollar figures are **projections** from internal rate tables (LLM, embeddings, TTS, STT). They are for ops visibility — **not** the vendor invoice.

STT may be shown at org level only (per-user STT can appear as “—”).

### 6.3 What happens when an org hits a cap

On the next chat/voice request, the user gets a graceful limit message and cannot continue until the **UTC daily reset** (or you raise the limit under Organizations).

---

## 7. Organizations — partner access control

**Path:** `/admin/orgs`

Organizations are the gated login tenants (e.g. Catalant). Each org has a shared email + password that partners use to start the adviser entry flow.

### 7.1 Create an organization

1. Click **Create organization** (or equivalent create control).
2. Enter:
   - **Name** (display name)
   - **Daily message limit** (default often `1000`)
   - **Daily Claude token limit**
   - **Daily TTS character limit**
   - **Daily STT second limit**
3. Submit.
4. A credentials modal shows **email + password**.
5. **Copy both** and send them to the partner through your secure channel.

The password is generated for you. You can **Reveal** it again later (see below) as long as encryption keys are intact.

### 7.2 Reveal password

1. On the org row, choose **Reveal**.
2. Confirm.
3. Copy email/password from the modal.

Sensitive reveals are logged server-side for audit.

> If production loses `ORG_SECRET_KEY`, reveal stops working. Users can still log in with the existing password; you would use **Reset password** to issue a new one.

### 7.3 Reset password

1. **Reset pw** → confirm.
2. New password appears in the modal — share it with the partner.
3. The old password stops working immediately for **new** logins.
4. **Existing user chat sessions are not force-killed** by a password reset. Use **Deactivate** if you need an immediate cut-off.

### 7.4 Change limits

- **Limit** (messages) and **Cost limits** (LLM / TTS / STT) update that org’s daily caps.
- Changes apply to the gating checks on subsequent requests.

### 7.5 Activate / Deactivate (kill switch)

- **Deactivate:** org cannot use the adviser on the next authenticated request (kill switch).
- **Activate:** restores access.

Use deactivate for security incidents, contract end, or abuse.

### 7.6 Table columns (typical)

| Column | Meaning |
|--------|---------|
| Name / email | Org identity used at login |
| Active | Kill-switch state |
| Today’s usage vs caps | Messages, tokens, TTS, STT |
| Users | How many agent users have enrolled under this org |
| Created | When the org was issued |

---

## 8. Cases — the cited case corpus

**Path:** `/admin/cases`

Cases are the **project evidence** Jackie cites with `[[case:ID]]`. They power retrieval (`search_cases`) and the auto-built **Layer 3 case index**.

### 8.1 Browse and filter

- Search by title / client / text.
- Filter by PE-backed (Yes / No / Unknown), industry, tech.
- Sort columns (title, client, industry, function, PE, tech, assets, updated).

### 8.2 Edit a case

1. Click a row.
2. Update fields such as:
   - Title, subtitle, client name
   - Industry, business function
   - PE-backed flag
   - Tech tags (comma-separated)
   - Narrative fields (overview, challenges, solution, benefits, results, etc.)
3. **Save**.

### 8.3 What happens on save

Behind the scenes the system:

1. Updates the case row  
2. Syncs tech tags  
3. **Re-embeds** the case for semantic search (needs embedding API configured)  
4. Invalidates the prompt cache so Layer 3 can refresh  
5. Bumps `updatedAt` (generated one-pagers based on old text become stale)

You should see a notice that re-embedding ran / may take a moment.

### 8.4 Layer 3 index (read-only)

At the bottom of Cases you can view the **generated case index**.  

**Do not invent cases by editing that index.** To add or change what appears there, edit the **case rows**. The index regenerates from titles + tech.

### 8.5 Operating rules

| Do | Don’t |
|----|-------|
| Keep titles accurate and searchable | Invent engagement metrics in Knowledge instead of Cases |
| Keep tech tags complete (AWS, RAG, etc.) | Leave PE / tech empty if known — it hurts retrieval |
| Fix placeholder client names | Expect prompt-only “new cases” without a DB row |

---

## 9. Case assets — files and one-pagers

**Path:** `/admin/assets`

### 9.1 Select a case

Search/select the case. The right panel lists existing assets for that case.

### 9.2 Asset kinds

| Kind | What to upload / enter |
|------|-------------------------|
| **One-pager** | PDF or PNG |
| **Full narrative** | PDF or PNG |
| **Deck / slide** | PDF or PNG |
| **Demo video** | URL (not a file) |

**File rules:** PDF or PNG only; max size typically **40 MB**.

### 9.3 Verified flag

Toggle **Verified** when the material is approved for use. Unverified assets remain stored but should be treated as not ready for customer-facing trust.

### 9.4 Generate one-pager

Use **Generate one-pager** as **PDF** or **PNG**. The browser downloads a branded one-pager built from current case fields.

Notes:

- Admin generate always builds from **live case data**.
- In chat, Jackie may prefer a previously **uploaded** official ONE_PAGER when one exists.
- After you edit case narrative, regenerate or re-upload so materials stay consistent.

### 9.5 Storage

With `BLOB_READ_WRITE_TOKEN` set (production), files go to durable object storage. Without it (local dev), files may land under `public/uploads/` and are not durable across deploys.

### 9.6 Delete

Delete removes the asset record (and storage object when possible). Confirm before deleting customer-ready materials.

---

## 10. Knowledge — company information (uncited)

**Path:** `/admin/knowledge`

### 10.1 Purpose and boundary (read this twice)

Knowledge is **company / product / process** content Jackie retrieves via `search_company_info`. She can use it for firm background **without** a case citation.

**Do NOT put here:**

- Client project claims  
- Case metrics / “we delivered X%” engagement outcomes  
- Anything that should require a `[[case:ID]]`

Those belong under **Cases** so citation validation applies.

The UI shows an amber **corpus boundary** warning for this reason.

### 10.2 Add knowledge

1. **Add knowledge** (or similar).
2. Enter **title** and **body** text.
3. Optionally attach **PDF** or **DOCX**.
4. Optionally enable **Shareable with users** and set a **share label** (so Jackie can offer `share_document`).
5. **Save & embed**.

### 10.3 How files are processed

- **PDF:** text is extracted in the browser before upload. Scanned image-only PDFs (no text layer) are rejected — no OCR.
- **DOCX:** extracted on the server.
- Content is chunked, embedded, and stored as `admin-knowledge` chunks for retrieval.

### 10.4 Edit / delete

- **Edit** updates text/file and re-embeds.
- **Delete** removes the entry and its chunks (confirm). Jackie will no longer retrieve that content.

### 10.5 Shareable documents

If **Shareable** is on, Jackie can offer to send that file to the user (corporate overview, etc.). Keep labels clear so the right document is offered.

---

## 11. Recommended operating playbooks

### 11.1 Onboard a new partner org

1. **Organizations → Create** with sensible daily caps.  
2. Copy credentials; send securely.  
3. Have them complete login → OTP → chat once.  
4. **Transcripts** → confirm a greeting turn works.  
5. **Usage** → confirm the org appears and counters move.

### 11.2 Change Jackie’s tone or commercial emphasis

1. **Prompts → Guidelines** → draft → preview → publish.  
2. Run 2–3 canary chats.  
3. **Transcripts** → verify behavior.  
4. If wrong, **publish the previous version** (rollback).

### 11.3 Add or fix a case study

1. **Cases** → edit fields + tech tags → save (wait for re-embed).  
2. **Case assets** → upload official one-pager / deck if available; mark **Verified**.  
3. Ask Jackie in chat about that domain; confirm she cites the right case.  
4. Check **Transcripts** for the citation.

### 11.4 Add company FAQ / overview content

1. **Knowledge** → add text (and optional shareable PDF).  
2. Confirm it is **not** a client delivery claim.  
3. Ask Jackie a firm question; answer should come from company search, not a fabricated case.

### 11.5 Partner hitting limits

1. **Usage** → confirm which cap is red.  
2. **Organizations** → raise that limit, or wait for UTC reset.  
3. If abuse: **Deactivate** instead of raising caps.

### 11.6 Suspected bad or unsafe answer

1. **Transcripts** → open the conversation.  
2. Note whether cases/tools were used.  
3. If prompt-related → adjust **Guidelines** or **Guardrails** carefully.  
4. If data-related → fix **Cases** / **Knowledge**.  
5. Do not “fix” safety by weakening Guardrails without review.

---

## 12. Security & access checklist

| Topic | Guidance |
|-------|----------|
| Admin accounts | Issued by engineering CLI only; don’t share passwords in Slack plaintext long-term |
| Org passwords | Reveal/reset only when needed; prefer secure handoff |
| Kill switch | Prefer **Deactivate** over hoping a password reset ends active sessions |
| Prompt publish | Preview first; Guardrails need extra care |
| Knowledge vs Cases | Never launder case metrics through Knowledge |
| Sessions | Admin sessions = 8h; org-user sessions are separate |

---

## 13. Quick reference — URLs

| Page | Path |
|------|------|
| Login | `/admin/login` |
| Dashboard | `/admin` |
| Prompts | `/admin/prompts` |
| Transcripts | `/admin/transcripts` |
| Transcript detail | `/admin/transcripts/<id>` |
| Usage | `/admin/usage` |
| Organizations | `/admin/orgs` |
| Cases | `/admin/cases` |
| Case assets | `/admin/assets` |
| Knowledge | `/admin/knowledge` |

---

## 14. What this portal does *not* do

- Create or reset **admin** users (CLI only)
- Edit Layer 3 case index text directly
- Edit chat messages or “unsend” user content
- Show vendor billing invoices (Usage $ is estimated)
- Replace engineering deploys, migrations, or env configuration
- Manage the marketing website CMS

For engineering handover details (secrets, rates, architecture), see `docs/handover/admin.md` and `docs/HANDOVER.md`.

---

## 15. Glossary

| Term | Meaning |
|------|---------|
| **Jackie** | The Commercial Adviser agent (chat + voice) |
| **Org** | Partner tenant with shared login credentials |
| **Case** | Cited project evidence row + embeddings |
| **Knowledge** | Uncited company corpus |
| **Live prompt version** | The published PromptVersion for a layer |
| **Draft** | Saved but not yet controlling the agent |
| **Kill switch** | `org.active = false` — blocks the org |
| **Layer 3 index** | Auto-generated case list inside the system prompt |
| **Verified asset** | Admin-approved case file |

---

*If something in the UI disagrees with this guide after a release, trust the product behavior and ask engineering to update this document.*
