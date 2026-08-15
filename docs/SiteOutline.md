# **Site Outline & Route Architecture**

## **1\. Overview & Access Control Strategy**

The platform consists of three distinct application zones:

1. **Public Site (Pre-Auth / Unauthenticated):** Informational pages, CMS blog posts, and a read-only calendar preview.  
2. **Member Portal (Post-Auth / Basic & Paid Members):** Interactive schedule booking, pass wallet, profile management, purchase flows, and transferable pass management.  
3. **Operations & Administrative Portal (Role-Based Access Control):** Dedicated interfaces for volunteers (Hosts, Content Editors, Model Bookers, Controllers) and full System Administrators.

### **Global Header Navigation Strategy**

All public pages feature a persistent, prominent call-to-action (CTA) button in the top navigation header (e.g., **"Book a Session"** / **"View Schedule"**).

* **Authenticated Members:** Clicking the button routes directly to /app/schedule.  
* **Unauthenticated Guests:** Clicking the button routes to /auth/login?redirect=/app/schedule (or /auth/register), seamlessly returning them to the interactive booking grid once signed in.

## **2\. Role-Based Access Control (RBAC) Summary**

| Role Code | Role Name | Scope & Description |
| :---- | :---- | :---- |
| GUEST | Unauthenticated Visitor | Public pages, read-only schedule, register/login forms. |
| ACCT | Basic Account Holder | Authenticated user. Can buy passes (standard rates), book standard sessions, and gift/claim transferable passes. |
| MBR | Paid Member | Authenticated user with active membership. Discounted rates, extended booking window, early renewal perks, plus bonus transferable pass perks. |
| VOL\_HOST | Volunteer: Session Manager | Assigned door duty. Accesses attendance check-in for assigned sessions without needing a pass. |
| VOL\_MKT | Volunteer: Content Editor | Marketing scope. Accesses CMS to publish blog posts and edit static page content. |
| VOL\_MBR | Volunteer: Model Booker | Booking coordinator. Accesses model scheduling matrix to assign models to sessions. |
| VOL\_CTRL | Volunteer: Controller | Financial reviewer. Views financial reports and generated model payout calculations in UI. |
| ADMIN | System Administrator | Full access to all administrative, user, billing, pass inventory, session, and CMS controls. |

*Note:* The four `VOL_*` codes represent sub-role scopes, not mutually exclusive account types — a single volunteer can hold multiple simultaneously (e.g. `VOL_HOST` + `VOL_MKT`), in which case they see the union of pages each role grants (Design Doc §5.2).

## **3\. Site Navigation & Page Directory**

### **3.1 Public & Guest Pages (GUEST / Open Access)**

These pages are publicly accessible without signing in. Content is delivered via the lightweight CMS or dynamic public endpoints. All public pages contain the persistent header booking CTA.

* / — **Home Page**  
  * *Purpose:* Welcome hero, upcoming featured sessions preview, society statement, key call-to-actions (Join / View Schedule).  
  * *Visibility:* GUEST (Redirects active logged-in members to /dashboard or shows custom member welcome banner).  
* /about — **About Us**  
  * *Purpose:* History, mission, studio location, rules of conduct, easel policies. Managed via CMS.  
  * *Visibility:* Public.  
* /schedule — **Public Schedule & Calendar**  
  * *Purpose:* Read-only 14-day schedule grid showing session types, times, and open slot counts.  
  * *Actions:* Clicking "Book" on any cell prompts unauthenticated users to log in or register.  
  * *Visibility:* Public.  
* /news & /news/:slug — **News & Blog Feed**  
  * *Purpose:* Community news, guest artist spotlights, exhibition announcements, and studio updates.  
  * *Visibility:* Public.  
* /contact — **Contact & FAQ**  
  * *Purpose:* Contact forms, studio directions, parking information, frequently asked questions.  
  * *Visibility:* Public.  
* /auth/login — **Login**  
  * *Purpose:* Authenticates existing users with username/password. Accepts redirect query parameters (e.g. ?redirect=/app/schedule or ?redirect=/app/wallet?action=claim\_pass\&code=XYZ). For Admin and Controller accounts, prompts for a TOTP code as a second step after password verification (Design Doc §5.1, `SecurityDocument.md` §2).  
  * *Visibility:* Unauthenticated only.  
* /auth/register — **Account Registration**  
  * *Purpose:* Sign up as a basic AccountHolder. Supports claiming guest/transferable pass referral links upon signup. Sends an email verification link; booking and purchasing remain blocked until the account is verified (Design Doc §5.1).  
  * *Visibility:* Unauthenticated only.

### **3.2 Member Portal Pages (ACCT, MBR)**

Accessible to any authenticated user holding either basic AccountHolder status or active Paid Member status.

* /dashboard — **Member Dashboard**  
  * *Purpose:* Central hub upon logging in.  
  * *Key Features:*  
    * Upcoming booked sessions banner (with count-down and quick-cancel).  
    * Available session pass balance summary (Standard Unused vs. Transferable Unassigned passes).  
    * Membership tier status card (Active Member expiration date or upgrade/renew prompt).  
  * *Visibility:* ACCT, MBR, VOL\_\*, ADMIN.  
* /app/schedule — **Interactive Schedule Grid & Booking**  
  * *Purpose:* The primary booking interface (horizontal 14-day rolling schedule).  
  * *Key Features:*  
    * Visual cell status: Available, Full (Waitlist), Registered, Missing Model, Far-Future Lock, Non-Cancelable (\<24h).  
    * **Session Booking Modal:** View session details, host name, assigned model, description, pass balance check.  
    * **Multi-Week Seat Selection Modal:** Interactive numbered seat map for Extra Long Pose series, date checkboxes, multi-pass calculation.  
    * **Waitlist Toggle:** Opt-in/opt-out of broadcast email alerts when sold-out sessions open up.  
  * *Visibility:* ACCT, MBR, VOL\_\*, ADMIN.  
* /app/wallet — **Pass Wallet & Storefront**  
  * *Purpose:* Storefront to buy passes/memberships and central hub for managing personal pass inventory and transferable passes.  
  * *Key Features:*  
    * Tiered dynamic pricing (reflects standard vs. discounted member rates).  
    * **Pass Inventory Split:** Distinct tabs/cards for **Standard Passes** (bound to user) and **Transferable Passes** (giftable or assignable).  
    * **Pass Actions:** "Gift / Transfer Pass to Member", "Claim Pass Code", and "View Pass Transfer History".  
  * *Visibility:* ACCT, MBR, VOL\_\*, ADMIN.  
* /app/wallet/claim — **Claim Transferable Pass Landing Page**  
  * *Purpose:* Dedicated landing route for users redeeming a transferable pass via a direct link or claim token code (e.g., from email or gift link).  
  * *Key Features:* Validates pass token, shows sender information, and prompts single-click assignment to the logged-in user's account. Automatically redirects unauthenticated recipients to login/register with return state.  
  * *Visibility:* ACCT, MBR, VOL\_\*, ADMIN.  
* /app/account — **Profile & Membership Management**  
  * *Purpose:* User account settings and membership audit trail.  
  * *Key Features:*  
    * Personal profile & contact info updates.  
    * Active membership status details & early-bird renewal action button (including summary of bonus transferable passes awarded).  
    * Historical membership spans log (showing valid start/end date ranges).  
  * *Visibility:* ACCT, MBR, VOL\_\*, ADMIN.  
* /app/history — **Order & Booking History**  
  * *Purpose:* Personal accounting and session attendance record.  
  * *Key Features:*  
    * Transaction history table with downloadable receipt details and payment gateway references.  
    * Booking history (past sessions attended vs. canceled).  
    * **Transfer Log:** History of transferable passes sent, received, or claimed.  
  * *Visibility:* ACCT, MBR, VOL\_\*, ADMIN.

### **3.3 Volunteer & Role-Restricted Workspaces (VOL\_\*, ADMIN)**

Scoped tools accessible based on specific volunteer roles or full admin status.

* /ops/check-in/:session\_id — **Session Manager Roster & Door Duty**  
  * *Purpose:* Digital attendance sheet and operational log for hosts running a specific session.  
  * *Key Features:*  
    * View attendee list (name, seat number if applicable, ticket status).  
    * Toggle "Attended / Checked-In" switch for attendees.  
    * **Attributed Session Notes Log:** Freeform chronological notes log accessible before, during, and after a session. Allows cross-role communication (e.g., Model Booker leaving instructions for the host regarding model arrival, Host leaving post-session notes or issue reports). Each note entry is timestamped and attributed to the authoring user.  
    * View emergency studio contact info and studio guidelines.  
  * *Visibility:* VOL\_HOST (assigned to this session only), VOL\_MBR, or ADMIN.  
* /ops/cms — **CMS Content Workspace**  
  * *Purpose:* Article publishing and static page editor.  
  * *Key Features:*  
    * Blog editor (Rich text / Markdown editor for news, images, title, publish date).  
    * Static page contents editor (About, FAQ, Announcement banners).  
  * *Visibility:* VOL\_MKT, ADMIN.  
* /ops/model-booking — **Model Assignment Matrix**  
  * *Purpose:* Assigning models from the roster to scheduled sessions.  
  * *Key Features:*  
    * Calendar view highlighting sessions flagged as "No Model Assigned".  
    * Model lookup and slot mapping dropdowns.  
    * Direct link to add pre-session notes/instructions to the session's operational log.  
  * *Visibility:* VOL\_MBR, ADMIN.  
* /ops/financials — **Financial & Model Payout Reports**  
  * *Purpose:* Read-only financial oversight and payroll calculation.  
  * *Key Features:*  
    * Weekly Model Payout Report generation (Sessions worked × Flat per-session rate).  
    * Historical payout sheets archive.  
    * Pass sales, bulk pass distributions, and membership renewal totals.  
  * *Visibility:* VOL\_CTRL, ADMIN.

### **3.4 System Administration Portal (ADMIN)**

Full platform management interface available exclusively to System Administrators.

* /admin/dashboard — **Admin Control Center**  
  * *Purpose:* High-level health metrics, system activity logs, open flags (missing models, full sessions).  
  * *Visibility:* ADMIN.  
* /admin/sessions — **Session & Calendar Creator**  
  * *Purpose:* Tooling to build and manage all 4 session patterns (Recurring Standard, Multi-Week Series, One-Off, Non-Ticketed).  
  * *Actions:* Edit session capacity, assign Session Managers/Hosts, update descriptions, cancel sessions.  
  * *Visibility:* ADMIN.  
* /admin/passes — **Pass Inventory & Transferable Pass Management**  
  * *Purpose:* Central repository for tracking all pass inventory across the system.  
  * *Key Features:*  
    * **Bulk Generation Tool:** Create blocks of transferable passes for corporate/institutional clients (e.g., animation studios, universities).  
    * **Transferable Pass Audit:** Search passes by status (Available, Assigned, Used), filter by batch ID or purchasing organization, re-issue lost claim codes, or revoke unredeemed transferable passes.  
  * *Visibility:* ADMIN.  
* /admin/users — **User Directory & Account Governance**  
  * *Purpose:* Full member database management.  
  * *Actions:*  
    * Search/Filter users by status (Active, Suspended, Banned), tier, or role.  
    * Manual Pass Grants (issue complimentary Standard or Transferable passes with audit reason).  
    * Issue refunds and un-assign booked passes.  
    * Adjust membership expiration dates manually.  
    * Assign volunteer sub-roles (SessionManager, ContentEditor, ModelBooker, Controller).  
    * Ban or suspend accounts (prevents future bookings).  
  * *Visibility:* ADMIN.  
* /admin/models — **Model Roster Management**  
  * *Purpose:* Maintain the list of models, legacy system ID mappings, contact information, and global pay rates.  
  * *Visibility:* ADMIN.  
* /admin/audit-logs — **System & Transaction Audit Logs**  
  * *Purpose:* Complete, immutable log of all state-changing actions across the system.  
  * *Key Features:* Filter by action type (PASS\_REFUNDED, TRANSFERABLE\_PASS\_CLAIMED, MEMBERSHIP\_EXTENDED, USER\_BANNED, etc.), actor ID, or target user ID.  
  * *Visibility:* ADMIN.

## **4\. Route Access Matrix**

| Route Pattern | Public (GUEST) | Basic (ACCT) | Member (MBR) | Host (VOL\_HOST) | Marketing (VOL\_MKT) | Model Booker (VOL\_MBR) | Controller (VOL\_CTRL) | Admin (ADMIN) |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| / , /about, /news, /contact | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /schedule (Read-only) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /auth/login, /auth/register | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| /dashboard, /app/\* | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /app/wallet/claim | 🟡 (Redirects) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| /ops/check-in/:id | ❌ | ❌ | ❌ | ✅ (Assigned) | ❌ | ✅ | ❌ | ✅ |
| /ops/cms | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| /ops/model-booking | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| /ops/financials | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| /admin/\* | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

## **5\. Modal & Overlay Architecture**

Modals handle high-frequency interactions across the platform without requiring full page navigation. They preserve user state and scroll positions on complex interfaces like the 14-day schedule grid and pass wallet.

### **5.1 Route-Based & Query-Param Deep Linking**

To ensure modals can be shared via URL or triggered cleanly, modal states are mirrored in URL query parameters or sub-routes:

* **Session Detail / Booking:** /app/schedule?session\_id=:uuid  
* **Multi-Week Seat Selection:** /app/schedule?session\_id=:uuid\&action=select\_seat  
* **Transfer / Gift Pass:** /app/wallet?action=transfer\_pass\&pass\_id=:uuid  
* **Claim Transferable Pass:** /app/wallet?action=claim\_pass\&code=:claim\_code  
* **Pass Transfer History:** /app/wallet?action=transfer\_history  
* **Session Notes Overlay:** /ops/check-in/:session\_id?tab=notes  
* **Admin Bulk Pass Generator:** /admin/passes?action=generate\_bulk

### **5.2 Member Portal Modals**

* **Standard Session Details & Booking Modal (/app/schedule)**  
  * *Trigger:* Clicking any active cell on the 14-day schedule grid.  
  * *Content:* Session Type Badge, date/time range, host/model names, detailed description, pass balance check.  
  * *Primary Actions:* "Book Session (Spend 1 Pass)", "Cancel Booking", "Join Waitlist", or "Buy Passes".  
* **Multi-Week Series & Seat Selection Modal (/app/schedule)**  
  * *Trigger:* Clicking an Extra Long Pose (X) or multi-week session cell.  
  * *Content:* Interactive seat map (Seats 1-25), availability matrix, date selection checkboxes, pass total calculation.  
  * *Primary Actions:* "Confirm & Reserve Seat \#X for Y Dates".  
* **Transfer / Gift Pass Modal (/app/wallet)**  
  * *Trigger:* Clicking "Gift / Transfer Pass" on an available transferable pass card in /app/wallet.  
  * *Content:*  
    * Recipient selection mode toggle: "Existing Member (Username/Email)" vs. "Sharable Claim Link / Gift Code".  
    * Pass quantity selector (if sending multiple transferable passes).  
    * Optional personal note / gift message.  
    * Expiration / revocation policy notice (noting pass becomes bound to recipient once accepted).  
  * *Primary Actions:* "Send Pass / Generate Gift Link".  
* **Claim / Redeem Transferable Pass Modal (/app/wallet)**  
  * *Trigger:* Navigating to /app/wallet?action=claim\_pass\&code=:code or clicking "Claim Code" in wallet.  
  * *Content:* Token input field (pre-filled if coming from claim link), pass origin details (sender name, institution, or membership perk source).  
  * *Primary Actions:* "Claim & Add Pass to My Account".  
* **Pass Transfer History & Audit Overlay (/app/wallet & /app/history)**  
  * *Trigger:* Clicking "View Transfer History" in pass wallet.  
  * *Content:* Detailed ledger of all transferable pass events: Passes Gifted (recipient, date, status: Pending / Claimed), Passes Received (sender, date), and Institutional Passes Claimed.  
  * *Primary Actions:* "Copy Claim Link" (for pending unredeemed gifts) or "Cancel / Revoke Unclaimed Transfer".  
* **Waitlist Opt-In Confirmation Modal (/app/schedule)**  
  * *Trigger:* Clicking "Join Waitlist" on a sold-out session.  
  * *Content:* Explanation of first-come, first-served email alert broadcast.  
  * *Primary Actions:* "Opt-In for Email Alerts".

### **5.3 Operational & Volunteer Modals (/ops/\*)**

* **Attributed Session Notes Log Drawer/Modal (/ops/check-in/:session\_id)**  
  * *Trigger:* Clicking "View / Add Notes" on the check-in roster.  
  * *Content:* Chronological feed of pre/post-session notes attributed by username and role (VOL\_MBR, VOL\_HOST, ADMIN). Rich markdown text area for submitting new notes.  
  * *Primary Actions:* "Post Note".  
* **Quick Model Assignment Modal (/ops/model-booking)**  
  * *Trigger:* Clicking an unassigned session on the Model Booking matrix.  
  * *Content:* Dropdown of roster models, notes field for model arrival instructions, check-box for "No Model Required".  
  * *Primary Actions:* "Assign Model", "Save & Notify Host".

### **5.4 System Administration Modals (/admin/\*)**

* **Bulk Transferable Pass Batch Generator Modal (/admin/passes)**  
  * *Trigger:* Admin clicking "Generate Bulk Pass Batch" in /admin/passes.  
  * *Content:*  
    * Client / Organization name input (e.g. "Local Animation Studio Inc.").  
    * Quantity of passes to issue.  
    * Pass type toggle (Transferable Bulk Pass Block).  
    * Distribution method: "Download CSV of Claim Codes" or "Assign directly to an existing Account Holder" (the institutional contact — no separate organization account type exists, see Design Doc §6.2).  
    * Associated purchase transaction reference ID (for accounting reconciliation).  
  * *Primary Actions:* "Generate Batch & Create Audit Record".  
* **Manual Pass Grant Modal (/admin/users)**  
  * *Trigger:* Admin selecting "Grant Passes" on a user profile row.  
  * *Content:* Quantity input, pass type toggle (**Standard Non-Transferable** vs. **Transferable Pass**), mandatory audit reason text box (e.g., "Customer service voucher", "Volunteer reward", "Membership bonus perk").  
  * *Primary Actions:* "Issue Passes & Log Action".  
* **Refund & Pass Cancellation Modal (/admin/users & /admin/audit-logs)**  
  * *Trigger:* Admin selecting "Issue Refund" on a past transaction.  
  * *Content:* Transaction item summary, gateway payment reference, partial or full refund amount inputs, option to revoke unspent or unredeemed transferable passes linked to the order.  
  * *Primary Actions:* "Process Refund via Gateway".  
* **Account Governance Modal (Ban / Suspend) (/admin/users)**  
  * *Trigger:* Admin selecting "Change Account Status".  
  * *Content:* Status radio buttons (Active, Suspended, Banned), reason entry, warning regarding automated cancellation of upcoming booked sessions upon banning.  
  * *Primary Actions:* "Update Account Status & Audit".  
* **Session Capacity & Details Override Modal (/admin/sessions)**  
  * *Trigger:* Admin editing an upcoming session instance.  
  * *Content:* Capacity spinner (default 25), host picker, session type switcher, description editor.  
  * *Primary Actions:* "Save Overrides".

### **5.5 Modal Interaction & Accessibility Rules**

1. **Focus Trapping:** When a modal is open, keyboard navigation (Tab / Shift+Tab) is trapped within the modal container.  
2. **Escape & Backdrop Dismissal:** Pressing Esc or clicking the semi-transparent backdrop closes non-destructive modals. Destructive modals (e.g., issuing refunds, banning accounts) require explicit button action.  
3. **Body Scroll Locking:** Opening a modal toggles overflow: hidden on the HTML \<body\> element to prevent background page scrolling.  
4. **ARIA Attributes:** All modals implement role="dialog", aria-modal="true", and aria-labelledby linked to the modal title heading for screen reader compatibility.