# **Software Design Document: Life Drawing Society Scheduling System**

## **1\. Overview**

This document outlines the design and architecture for a new, all-in-one web platform built for a life drawing society. The system is scoped to host both the public-facing static website (informational pages, about us, contact) and the authenticated web application where members can view upcoming sessions, check model status, manage their registrations, and handle administrative duties.

## **2\. Goals & Audience**

* **Primary Audience:** Society members who need a quick, intuitive way to see the schedule and book or cancel sessions.  
* **Secondary Audience:** Admins managing the schedule, models checking assignments, and volunteers handling door duties.  
* **Primary Goal:** Provide a dense, readable 14-day forecast of events that clearly communicates booking status, session types, and cancellation rules at a glance.

## **3\. UI/UX Interface (Member Portal)**

### **3.1 The Schedule Grid**

The primary interface is a horizontally scrollable grid designed for maximum data density while remaining touch-friendly.

* **Columns (Days):** Represents a rolling 14-day window starting from the current day. Dates and days of the week are displayed in the header. The current day is visually highlighted.  
* **Rows (Time Slots):** Divided into three broad categories: Morning, Afternoon, and Evening. These act as flexible "windows of opportunity" for sessions rather than strict, fixed hours across the board. Exact start and end times, along with specific event notes, are defined within individual session details.  
  * **Morning:** Typically 10:00 AM \- 1:00 PM  
  * **Afternoon:** Typically 2:00 PM \- 5:00 PM  
  * **Evening:** Typically 6:00 PM \- 9:00 PM or 7:00 PM \- 10:00 PM  
* **Cells:** Compact square cells (approx. 48x48px) representing individual sessions.

### **3.2 Session Typology**

Sessions are visually identified by a dominant central letter or emoji. *Note: The specific colors listed below are currently placeholders. See Section 4 (Visual Design Philosophy) for details on the broader approach to color and styling.*

* **L:** Long Pose  
* **R:** Regular  
* **G:** Gesture  
* **P:** Portrait  
* **S:** Special  
* **X:** Extra Long Pose (Often multi-week)  
* **🖼️:** Gallery Hours  
* **🥳:** Party

### **3.3 Visual Status Indicators**

The state of a session is communicated through cell styling and small overlay icons:

* **No Session Scheduled:** Solid light gray cell.  
* **Available to Book:** White cell with a standard border.  
* **Too Far in Future (Not Yet Bookable):** Grayscale cell with reduced opacity, showing the session letter but unclickable.  
* **Registered:** Light green background, thick green border, and a checkmark icon in the top right.  
* **Session Full (Sold Out):** Muted red or gray background with a strikethrough or "Full" badge. Clicking this state allows the user to join the waitlist.  
* **No Model Assigned:** Light amber background, dashed amber border, and a "missing user" icon in the top left. (Note: Can overlap with 'Available' or 'Registered' states).  
* **Non-Cancelable (\< 24 Hours):** Registered state with an added red lock icon in the bottom right.

### **3.4 Interaction Flows**

* **Viewing Details:** Clicking an active cell opens a modal overlay.  
* **Session Modal:** Displays full session details, specific dates/times, assigned Session Manager (Host), descriptive text, and dynamic warning banners (e.g., "Cancellation Locked", "Searching for Model", "Session Full").  
* **Standard Booking/Canceling/Waitlist:** The modal contains the primary call-to-action button, which dynamically toggles between "Book this Session", "Cancel Registration", or "Join Waitlist" (if the session is full). The button is disabled if the 24-hour non-cancelable window has been reached.  
* **Multi-Week Series Booking:** For linked, multi-week sessions (like Extra Long Poses), the booking interface transforms. Users are presented with a seat map or list of specific numbered seats. Upon selecting an available seat, they can check off which specific dates in the series they wish to book that seat for. The UI calculates the required number of passes and warns the user if their balance is insufficient.

## **4\. Visual Design Philosophy**

*(This section will define the overarching approach to styling, color palettes, typography, and accessibility. The goal is to establish a cohesive look and feel that serves both form and function.)*

* **Color Palette Strategy:**  
  *TBD \- e.g., Are we using a strict, limited palette? Are colors purely functional (indicating status) or also aesthetic?*  
* **Accessibility (a11y):**  
  *TBD \- e.g., Ensuring color contrast meets WCAG standards, supporting screen readers, providing alternatives to color-only indicators.*  
* **Typography & Spacing:**  
  *TBD*

## **5\. Authentication & User Roles**

The application will use an in-house authentication system and support multiple tiers of access.

### **5.1 Authentication Mechanism**

The system manages its own user accounts directly. User credentials (usernames and hashed passwords) are securely captured and stored within the application's own database.

**Email Verification:** Newly registered accounts must verify their email address (via a confirmation link) before they can book sessions or make purchases. Browsing the public site and read-only schedule does not require verification.

**Multi-Factor Authentication:** Admin and Controller accounts are required to enable MFA (TOTP-based) given their access to refunds, bans, and financial reports. See `SecurityDocument.md` §2 for enforcement details.

### **5.2 User Tiers & Permissions**

Users are categorized into distinct roles that dictate their access level and capabilities within the system:

* **Account Holders:** Basic registered users. They can book any type of session, but they have a restricted booking window (cannot book as far in advance as paid members) and pay the standard, non-discounted rate for sessions.  
* **Paid Members:** Users with an active financial membership to the society. They receive a discounted rate on sessions and have access to an extended booking window, allowing them to secure spots further in the future.  
* **Volunteers:** Members in good standing who assist with operations. Most volunteer types receive one free session pass per week. A volunteer may hold **multiple sub-roles simultaneously** (e.g. the same person can be both a Session Manager and a Content Editor) — sub-roles are not mutually exclusive. Specific sub-roles include:  
  * **Session Manager (Host):**  
    * Assigned to host specific sessions. Every session created requires an assigned Host (or designated open Host slot for assignment).  
    * They do not get paid, but do not require a session pass to attend the session they are managing.  
    * **Special UI Permissions:** When viewing a session they are assigned to manage, they have access to a "Check-in" interface allowing them to view the roster and mark registered participants as attended.  
    * Admins must be able to swap assigned Session Managers (e.g., in case a substitute is needed).  
  * **Content Editor / Marketing:**  
    * Granted specific access to the CMS to update news, blog posts, and static website pages without requiring full system administration privileges.  
  * **Model Booker:**  
    * Responsible for reviewing model requests and formally assigning models to upcoming sessions. Admins can back them up in this ability.  
  * **Controller:**  
    * Holds a volunteer account to access financial and model payout reports within the administrative UI, though their primary workflow remains email-based.  
* **Admin:** A single, overarching administrative tier with full access to all backend systems. Admins can create and manage sessions, book models (acting as a backup for the Model Booker), generate financial reports, and manage users. To handle support and moderation, Admins can issue financial refunds, manually grant session passes to users, and ban or suspend user accounts (revoking their ability to book future sessions). Rather than relying on strict system sub-roles, these tasks are distributed organizationally among all admins, ensuring strong backup capability and operational redundancy.

### **5.3 Account & Membership Management**

A dedicated section of the application will be required for users to manage their profiles. Beyond basic account settings, this portal will track and manage active membership status, facilitate membership renewals, and handle the processing of membership fee payments. Historical membership spans (start and end dates) will be logged to maintain an accurate audit trail of when an account held active member status versus basic account holder status.

## **6\. Session Passes & Inventory**

To facilitate booking, the system utilizes "Session Passes" which users accumulate and spend.

### **6.1 Standard Session Passes**

* **Ownership:** Strictly tied to the purchasing Account Holder and are **non-transferable**.  
* **Default State:** Unused (visible in the user's available pass balance).  
* **Booking Lifecycle:** When a user registers for a session, a pass transitions out of the Unused state. It becomes uniquely assigned to the pair of *Session ID \+ Account Holder ID*. Once assigned, it is locked to that event, cannot be reused, and is hidden from the user's pool of available passes.  
* **Cancellation & Release:** Date math is evaluated against the session start time and the cancellation cutoff (e.g., 24 hours prior). If a user cancels before the cutoff, the pass un-associates from the session and returns to their available balance.  
* **Expiration:** Passes do not expire. Once issued (purchased, granted, or received as a transfer), a pass remains in a user's balance indefinitely until spent, refunded, or administratively revoked.  
* **Revocation:** Admins can revoke unspent or unredeemed passes (e.g. as part of processing a refund, Section 7 / Site Outline's Refund Modal). A revoked pass is not deleted — it is marked in a terminal `Revoked` state so the audit trail of its issuance and revocation is preserved.

### **6.2 Transferable Passes**

A special category of passes designed to be given away or distributed.

* **Constraint:** A transferable pass must be explicitly assigned to an account holder *prior* to being used to book a session.  
* **Primary Use Cases:**  
  * **Membership Perks:** Granting a set number of free, transferable passes as a bonus when a user pays their annual membership dues.  
  * **Institutional/Bulk Purchases:** Allowing organizations (e.g., local animation schools, studios) to buy blocks of passes in bulk, which they can then distribute and assign to their students or employees. The institutional contact is a regular Account Holder — no separate "organization" account type exists. Admins assign a generated batch either directly to that contact's account or as a downloadable CSV of claim codes for the contact to distribute manually; either way, the batch is tracked (organization name, quantity, originating transaction) for accounting and audit purposes.

**Gift / Claim Mechanics:** A transferable pass being sent to a specific person (as opposed to a bulk institutional batch) generates a unique claim code and optionally carries a short gift note from the sender. The recipient redeems the code at `/app/wallet/claim` (Site Outline §3.2), which assigns the pass to their account and records when it was claimed.

### **6.3 Capacity & Seat Reservation Limits**

The system requires flexible capacity management to accommodate different physical setups in the studio space.

* **Default Capacity:** New sessions will default to a maximum capacity of 25 attendees.  
* **Variable Capacity:** Admins can reduce the maximum capacity for specific sessions (e.g., accommodating larger easels or specific model seating arrangements).  
* **Maximum Bound:** While current studio constraints mean no sessions exceed 25 attendees, the database and backend logic will **not** enforce a hard maximum limit. This ensures the system remains scalable for future larger events or different venues.

### **6.4 Waitlist Mechanism**

When a session reaches its maximum capacity, users can opt-in to a waitlist.

* **Alert System, Not a Queue:** The waitlist functions strictly as an email notification list. It does not automatically register the next person in line.  
* **First Come, First Served:** If a registered user cancels and a spot opens up, an automated email alert is broadcast to all users on the waitlist. The open spot is then claimed on a "first come, first served" basis by whoever logs in and books it first.

### **6.5 Multi-Week Series & Reserved Seating**

Some sessions, particularly multi-week poses with the same model, require artists to have consistent viewing angles over several sessions.

* **Numbered Seat Inventory:** These sessions utilize a numbered seating system. When booking, users reserve a specific "Seat Number" rather than just a general admission slot.  
* **Partial Series Booking:** Users can pre-book multiple dates in a series simultaneously. If a user books a specific seat for only a partial set of the available dates (e.g., weeks 1, 2, and 4), that exact seat becomes available to other users *only* for the unbooked session (e.g., week 3).  
* **Pass Deduction:** The system deducts one session pass for every individual date booked within the series.  
* **UI Seat States:**  
  * **Full Series Available:** Seat \#X is open for all dates in the multi-week series (highlighted in solid green or clear status).  
  * **Partial Series Available:** Seat \#X is taken on some dates but open on others (highlighted with a split or badge indicator showing which dates remain).  
  * **Fully Reserved:** Seat \#X is occupied for all dates in the series.  
  * **User Reserved:** Seat \#X is reserved by the currently logged-in user for all or a subset of dates.

### **6.6 Effective Price & Yield Tracking**

To enable accurate return-on-investment (ROI) analysis, cost accounting, and attendance yield statistics, every generated pass explicitly records an effective\_price at the time of creation:

* **Single Pass Purchase:** effective\_price equals retail amount paid (e.g., $20.00 for non-members, $17.00 for members).  
* **Pass Packs:** Total pack cost is divided evenly across individual passes issued (e.g., Member 10-pack at $130.00 yields $13.00/pass; Member 5-pack at $75.00 yields $15.00/pass; Non-member 5-pack at $90.00 yields $18.00/pass).  
* **Complimentary & Volunteer Passes:** Volunteer weekly allowances, promotional grants, and complimentary admin passes record an effective\_price of $0.00.  
* **Membership Bonus Passes:** Bonus transferable passes included with membership fees record $0.00 or an allocated proportion of annual dues for accounting purposes.

## **7\. Payments & E-Commerce**

The application will feature an integrated storefront using a payment gateway managed directly by the organization.

### **7.1 Purchasable Items & Tiered Pricing**

Users can purchase the following items through the system:

* **Single Session Passes:**  
  * Non-Member / Standard Rate: $20.00  
  * Active Member Rate: $17.00  
* **Pass Packs (Bulk Bundles):**  
  * Member 5-Pack: $75.00 ($15.00/pass)  
  * Member 10-Pack: $130.00 ($13.00/pass)  
  * Non-Member 5-Pack: $90.00 ($18.00/pass)  
* **Annual Membership Renewals:**  
  * Standard Annual Dues: $60.00  
  * Early-Bird Renewal Rate: Configurable discount prior to expiration.

**Dynamic Pricing:** The cost of single passes, packs, and renewals automatically adjusts based on user membership tier.

**Auditability & Reconciliation:** Every purchase generates an immutable transaction record (containing payment gateway reference codes, item breakdown, price paid, and timestamp) to allow admins and the treasurer to investigate customer queries or reconcile billing discrepancies.

**Sales Tax:** Listed prices are treated as final — the system does not calculate, collect, or track sales tax/VAT. This is an assumption based on the organization's current scale and should be confirmed with the treasurer; if tax collection becomes a requirement, the recommended path is adopting Stripe Tax rather than hand-rolling tax logic (see `ArchitectureDocument.md` §7).

**Refunds:** Admins can issue partial or full refunds against a transaction (Site Outline §5.4 Refund Modal). A transaction tracks the amount actually refunded separately from the original amount paid, so partial refunds don't overwrite the original charge record. Issuing a refund does not automatically revoke passes already spent on an attended session — the admin separately chooses whether to revoke any still-unspent or unredeemed passes tied to that order (see §6.1 Revocation).

### **7.2 Membership Renewals**

* **Billing Cycle:** Memberships are active for a standard year and renew at a flat fee ($60.00).  
* **Early-Bird Discount:** To incentivize retention, members who choose to renew their membership *before* their current active year expires are granted a discounted renewal rate.

### **7.3 Payment Webhooks & Payout Reconciliation**

To ensure the Treasurer has full transparency into bank deposits and net accounting:

* **Webhook Listener Endpoint:** The system exposes a secure webhook endpoint to receive asynchronous events from the payment processor (e.g. payout/transfer events, transaction settlement, chargebacks/refunds).  
* **Fee & Net Capture:** When payouts occur, webhook payloads are parsed to extract payment processor processing fees, gross amounts, net deposit amounts, and payout batch identifiers (payout\_batch\_id).  
* **Reconciliation Linkage:** Each transaction record links to its respective gateway payout batch, allowing the Treasurer to cross-reference bank statement transfers directly against individual pass sales, pack purchases, and membership renewals.

## **8\. Content Management (CMS)**

To handle the public-facing areas of the platform efficiently, the system will incorporate a lightweight Content Management System (CMS). Access to the CMS will be scoped to the specific **Content Editor / Marketing** volunteer role, ensuring the social media team can maintain the site securely without granting them full administrative access over billing or scheduling.

* **Static Pages:** Allows designated volunteers to easily update core informational pages (e.g., About Us, Contact, FAQ) without requiring developer intervention or code deployments.  
* **News & Announcements:** Provides a blog-like interface for composing, formatting, and publishing timely updates, text, and images to keep the community engaged.

## **9\. Session Scheduling & Administration**

To keep the calendar populated, administrators will be provided with an interface designed to mirror the layout of the primary member calendar grid, adapted specifically for quick event creation and management.

### **9.1 Interactive Admin Scheduling Grid UI**

* **Grid Mirroring:** Displays the rolling calendar grid (Days × Time Slots) with existing sessions styled by type and status.  
* **Slot Creation Trigger (+ Icon):** On any open time slot without a scheduled session, a prominent \+ (Add Session) icon button appears. Clicking the \+ icon opens the **Session Creation Workspace Modal** with the date and time pre-selected.  
* **Inline Session Controls:** Clicking an existing scheduled session cell in the admin grid opens inline admin management actions (e.g., Edit Capacity, Assign Host / Session Manager, Assign Model, Cancel Instance, or View Attendance Roster).

### **9.2 Event Creation Workflows & Core Session Parameters**

Regardless of session type, every session definition requires specifying key operational attributes:

1. **Session Type & Description:** Type classification (L, R, G, P, S, X, Gallery, Party) and descriptive body text/notes.  
2. **Schedule Parameters:** Date, start time, end time, and capacity limit.  
3. **Assigned Session Manager (Host):** Selection of the designated volunteer Session Manager responsible for hosting and managing attendance check-in for that specific instance.  
4. **Model Assignment Requirements:** Defining whether the session requires a single model, multiple models (for multi-model poses), or zero models (e.g., gallery hours, non-ticketed events, or ticketed sessions intentionally without a model).

Admins can build and publish events using four primary patterns:

* **Recurring Standard Sessions:** Used for ongoing events that repeat indefinitely (e.g., a Regular session every Monday from 6:00 PM \- 9:00 PM). Admins select a start date, frequency rule, host assignment default, and end date (or perpetual rollout). This defines a **Recurrence Rule** that the system uses to automatically populate individual session instances forward on the schedule, keeping a rolling booking window populated (see `ArchitectureDocument.md` §8 for the background job that extends this window).  
  * **Editing or Canceling an Occurrence:** When an admin edits or cancels a session that belongs to a recurring rule (e.g. skipping a single week for a holiday, or changing the host going forward), they choose one of three scopes — mirroring the standard calendar-app pattern: **this occurrence only** (detaches just that instance from the rule's template), **this and all future occurrences** (splits the rule: the current rule ends at this date, a new rule takes over from here with the updated parameters), or **the entire series** (updates the rule's template and all not-yet-individually-modified future instances). Past instances are never altered by a rule-level edit.  
* **Multi-Week Series Creation UI:** Used for finite, linked sessions (e.g., a 4-week Extra Long Pose).  
  * **Interactive Slot Range Selector:** Admins are presented with a multi-week calendar matrix. They can select multiple open slots across consecutive or non-consecutive weeks (e.g., selecting Weeks 1, 2, and 4 while skipping a holiday on Week 3).  
  * **Series Linking:** Grouping these selected slots into a single multi-week series unlocks the reserved numbered seat map (Seats 1-25) across all dates in the series, enabling partial or full series seat reservations for members.  
* **One-Off Sessions:** Standalone events created by clicking the \+ icon on a single open calendar slot (e.g., a weekend Portrait workshop).  
* **Non-Ticketed Events:** Informational blocks placed on the schedule (e.g., Gallery Openings, Gallery Hours, Membership Meetings). These block out studio time and advertise events without consuming session passes, requiring standard booking logic, or requiring models.

## **10\. Reporting & Analytics**

The system will feature a dedicated administrative portal for tracking organizational health, financials, and historical data.

* **Statistics Dashboard & Stats API:** An interface and secure REST/GraphQL API for admins to view general account information, monitor historical session attendance trends, analyze pass yield / effective revenue, and review system logs. The API supports authenticated querying by external tools and scripts for custom reporting.  
* **Financial & Reconciliation Reports:** Tools to generate reports on pass sales, membership revenue, transaction histories, processing fee breakdowns, and payout transfer batches to assist the Treasurer with accounting, auditing, bank reconciliation, and tax filings.  
* **System & Account Audit Logs:** A complete log tracking state changes over time—such as administrative pass grants, manual membership adjustments, refunds, and bans—allowing admins to reconstruct account history when troubleshooting user issues.  
* **Model Payout Reports:** The system will automatically generate a weekly payout report. This report calculates the total number of sessions worked by each model in the given week and multiplies it by a globally defined, flat per-session rate (which Admins can update periodically, e.g., annually) to output the total amount owed. This report will be emailed directly to the organization's Controller to streamline the payroll process. Additionally, the Controller (who holds a volunteer account) and Admins can view these generated reports directly within the administrative UI, ensuring flexibility for current and future payroll workflows.

## **11\. Model Management & Legacy Integration (Phase 1\)**

For the initial launch of this system, the workflow for models requesting and claiming sessions will remain decoupled.

* **Legacy System Usage:** Models will continue to use the organization's existing, separate legacy software interface to view availability and request session slots.  
* **Manual Assignment:** The designated **Model Booker** volunteer will review requests in the legacy system and manually assign models to the corresponding sessions within this new scheduling application. All Admins retain the ability to perform these assignments to serve as a reliable backup.  
* **Model Configurations:** The new system's backend must support sessions having zero models (intentionally, for ticketed non-model events or non-ticketed gallery hours), a single model, or multiple models assigned to the same session for multi-model poses.  
* **Contact Info Visibility:** A model's `contact_info` (Section 13) is private and only visible to the Model Booker volunteer role and Admins — never exposed to Account Holders, Paid Members, or other volunteer roles, including on the public schedule or session detail modal.

## **12\. System Configuration & Global Business Rules**

To allow the organization to adjust operational parameters without requiring code redeployments, the system will maintain a central, admin-configurable configuration store.

### **12.1 Dynamic Parameters & Default Settings**

| Category | Parameter Key | Default Value | Description |
| :---- | :---- | :---- | :---- |
| **Pricing** | PRICE\_SINGLE\_PASS\_STANDARD | $20.00 | Retail price for a single session pass for basic Account Holders. |
| **Pricing** | PRICE\_SINGLE\_PASS\_MEMBER | $17.00 | Discounted single pass price for active Paid Members. |
| **Pricing** | PRICE\_PACK\_5\_STANDARD | $90.00 | Bulk 5-pass pack price for basic Account Holders ($18.00/pass). |
| **Pricing** | PRICE\_PACK\_5\_MEMBER | $75.00 | Bulk 5-pass pack price for active Paid Members ($15.00/pass). |
| **Pricing** | PRICE\_PACK\_10\_MEMBER | $130.00 | Bulk 10-pass pack price for active Paid Members ($13.00/pass). |
| **Pricing** | MEMBERSHIP\_ANNUAL\_FEE | $60.00 | Standard annual membership renewal fee. |
| **Timing** | CANCELLATION\_CUTOFF\_HOURS | 24 | Hours before session start time where bookings lock and become non-cancelable. |
| **Timing** | BOOKING\_WINDOW\_ACCOUNT\_DAYS | 14 | How many days into the future basic Account Holders can view and book sessions. |
| **Timing** | BOOKING\_WINDOW\_MEMBER\_DAYS | 30 | How many days into the future Paid Members can view and book sessions. |
| **Operations** | SESSION\_DEFAULT\_CAPACITY | 25 | Default maximum capacity assigned when creating a new session. |
| **Operations** | MODEL\_FLAT\_PAY\_RATE | $60.00 | Flat payment rate per session worked, used to calculate weekly Controller payout reports. |
| **Operations** | VOLUNTEER\_WEEKLY\_PASS\_ALLOWANCE | 1 | Number of complimentary passes granted weekly to eligible active volunteers. |
| **Perks** | MEMBERSHIP\_BONUS\_PASSES | 2 | Number of free transferable passes granted automatically upon annual membership purchase/renewal. |

### **12.2 Admin Overrides & Versioning**

* **UI Settings Panel:** System Administrators can view and modify all global settings directly via /admin/settings.  
* **Audit Trail:** Every change to a system setting creates an entry in System\_Audit\_Logs recording the setting key, old value, new value, changing admin user ID, and timestamp.  
* **Historical Integrity:** Changes to pricing parameters only apply to *future* purchases and do not alter existing transaction records or spent pass values.

## **13\. Draft Data Models**

The following schemas outline the conceptual database structure required to support the application's core functionality and audit history.

### **System Settings / Config**

| Field | Type | Description |
| :---- | :---- | :---- |
| key | String | Primary Key (e.g., MODEL\_FLAT\_PAY\_RATE, CANCELLATION\_CUTOFF\_HOURS). |
| value | String | Current parameter value stored as string (parsed based on data\_type). |
| data\_type | Enum | Decimal, Integer, Boolean, String. |
| description | String | Admin-facing explanation of the setting. |
| updated\_at | DateTime | Timestamp of last modification. |
| updated\_by | UUID | Foreign Key to Admin user who last updated the parameter. |

### **Users & Accounts**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| username | String | Unique identifier for login. |
| password\_hash | String | Securely hashed credential. |
| email | String | User contact and waitlist notifications. |
| email\_verified\_at | DateTime | Nullable. Booking/purchasing is blocked until set (Section 5.1). |
| base\_role | Enum | AccountHolder, Admin. (Paid Member status derived from active membership history). |
| mfa\_enabled | Boolean | Required true for Admin and Controller accounts before they can perform privileged actions (Section 5.1; see `SecurityDocument.md` §2). |
| membership\_expires\_at | DateTime | If current date is before this, user is considered an active Paid Member. |
| status | Enum | Active, Suspended, Banned. |

*Note:* Volunteer sub-roles moved out of this table into `Volunteer_Roles` below, since a user can hold more than one simultaneously (Section 5.2) — a single enum column can't represent that.

### **Volunteer Roles (Join Table)**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| user\_id | UUID | Foreign Key to the volunteer's user account. |
| role | Enum | SessionManager, ContentEditor, ModelBooker, Controller. |
| assigned\_at | DateTime | When this sub-role was granted. |
| assigned\_by | UUID | Foreign Key (Nullable) to the Admin who assigned it. |

A user has zero or more rows here; zero rows means they hold no volunteer sub-role. Uniqueness constraint on (user\_id, role) — the same role can't be double-assigned to one user.

### **Membership History**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| user\_id | UUID | Foreign Key to user account. |
| transaction\_id | UUID | Foreign Key (Nullable) to associated purchase transaction. |
| valid\_from | DateTime | Start timestamp of membership validity period. |
| valid\_until | DateTime | End timestamp of membership validity period. |
| granted\_by | UUID | Foreign Key (Nullable) to Admin if manually granted/adjusted. |

### **Transactions / Orders**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| user\_id | UUID | Foreign Key to purchasing user account. |
| gateway\_ref\_id | String | Payment gateway transaction code for reconciliation. |
| amount\_paid | Decimal | Total gross price charged to customer. |
| processing\_fee | Decimal | Gateway fee captured via webhook/API response. |
| net\_amount | Decimal | Net payout deposited (amount\_paid \- processing\_fee). |
| charge\_status | Enum | Succeeded, Failed, Refunded, Disputed. State of the underlying charge itself. |
| refunded\_amount | Decimal | Nullable. Populated when a partial or full refund is issued (Section 7.1); full refund means refunded\_amount \= amount\_paid. |
| payout\_batch\_id | String | Identifier linking transaction to payment processor payout batch/transfer. |
| payout\_status | Enum | Pending, Paid\_Out. State of the *deposit/payout* to the org's bank account — kept separate from charge\_status since a charge can succeed well before its payout settles. |
| item\_type | Enum | SinglePass, PassPack, MembershipRenewal. |
| created\_at | DateTime | Immutable timestamp of purchase. |

### **System Audit Logs**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| actor\_id | UUID | Foreign Key to user or admin executing the action. |
| action\_type | String | E.g. MEMBERSHIP\_EXTENDED, PASS\_REFUNDED, USER\_BANNED, PASS\_GRANTED, SETTING\_CHANGED. |
| target\_user\_id | UUID | Foreign Key (Nullable) to user affected by action. |
| metadata | JSON / Text | Contextual details (e.g. prior expiration date, refund amount, setting key/value changes). |
| created\_at | DateTime | Timestamp of event execution. |

### **Sessions**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| series\_id | UUID | Foreign Key (Nullable). Links to a Multi-Week Series group (Section 6.5's numbered-seat series — distinct from recurrence\_rule\_id below). |
| recurrence\_rule\_id | UUID | Foreign Key (Nullable). Links to the `Recurrence_Rules` row that generated this instance, for Recurring Standard Sessions (Section 9.2). Mutually exclusive with series\_id in practice — a session is either a generated recurring instance or part of a multi-week series, not both. |
| status | Enum | Scheduled, Canceled. |
| session\_type | Enum | L, R, G, P, S, X, Gallery, Party. |
| description | Text | Detailed description, specific event notes, or public instructions for the session. |
| start\_time | DateTime | Specific start time and date. |
| end\_time | DateTime | Specific end time and date. |
| max\_capacity | Integer | Default 25\. Can be manually overridden per session. |
| is\_ticketed | Boolean | True for standard sessions, False for Gallery/Meetings. |
| host\_user\_id | UUID | Foreign Key (Nullable). Assigned Session Manager / Host (Volunteer). |

### **Recurrence Rules**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| session\_type | Enum | Template value applied to generated instances. |
| frequency | String | e.g. weekly-on-Monday. Kept as a simple structured string/small JSON rather than a full RRULE grammar, given the studio's schedule patterns are simple and regular. |
| default\_host\_user\_id | UUID | Foreign Key (Nullable). Default host applied to generated instances. |
| start\_date | Date | First date this rule generates instances from. |
| end\_date | Date | Nullable — null means perpetual rollout (Section 9.2). |
| superseded\_by\_rule\_id | UUID | Foreign Key (Nullable). Set when an admin edits "this and future occurrences," which ends this rule and points to the new rule that took over (Section 9.2). |
| created\_by | UUID | Foreign Key to the Admin who created the rule. |

### **Session Notes / Operational Log**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| session\_id | UUID | Foreign Key to the specific session. |
| author\_user\_id | UUID | Foreign Key to the user (Volunteer/Admin) creating the note. |
| content | Text | Freeform pre- or post-session communication/instruction. |
| created\_at | DateTime | Timestamp of comment creation. |

### **Passes**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| owner\_id | UUID | Foreign Key (Nullable initially if transferable, otherwise required). |
| session\_id | UUID | Foreign Key (Nullable). Populated when pass is spent to book a session. |
| checked\_in | Boolean | Default false. Set by a Session Manager or Admin during check-in (Section 5.2, Site Outline §3.3) once the pass's owner has actually attended. |
| transaction\_id | UUID | Foreign Key (Nullable) to purchase transaction for accounting audit. |
| batch\_id | UUID | Foreign Key (Nullable) to `Pass_Batches`, for institutional/bulk-generated passes (Section 6.2). |
| is\_transferable | Boolean | Determines if it can be re-assigned before use. |
| status | Enum | Available, Assigned (for transferable), Used (locked to booked session), Revoked (Section 6.1). |
| sender\_user\_id | UUID | Foreign Key (Nullable). Set when a transferable pass is gifted person-to-person, identifying who sent it. |
| claim\_code | String | Nullable, unique. Redemption token for a gifted transferable pass (Section 6.2, Site Outline `/app/wallet/claim`). |
| claim\_note | Text | Nullable. Optional gift message from the sender. |
| claimed\_at | DateTime | Nullable. When the recipient redeemed the claim code. |
| effective\_price | Decimal | Effective revenue/cost realized for this individual pass ($0.00 for free/volunteer passes, calculated unit rate for bundles). Tracked for financial yield and ROI statistics. |

### **Pass Batches**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| organization\_name | String | e.g. "Local Animation Studio Inc." (Section 6.2). |
| quantity | Integer | Number of passes issued in this batch. |
| transaction\_id | UUID | Foreign Key (Nullable) to the associated purchase, for reconciliation. |
| created\_by | UUID | Foreign Key to the Admin who generated the batch. |
| created\_at | DateTime | Timestamp of batch generation. |

### **Seat Reservations (For Multi-Week Series)**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| session\_id | UUID | Foreign Key to specific session in the series. |
| user\_id | UUID | Foreign Key to the attending user. |
| pass\_id | UUID | Foreign Key to the spent pass. |
| seat\_number | Integer | The physical studio seat reserved. |
| checked\_in | Boolean | Default false. Per-date attendance flag, set during check-in (Section 5.2) for this specific seat/date. |

### **Waitlist Entries**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| session\_id | UUID | Foreign Key to the full session. |
| user\_id | UUID | Foreign Key to the user waiting. |
| created\_at | DateTime | Used to order the waitlist conceptually, though alerts are broadcast to all. |
| notified\_at | DateTime | Nullable. Set when the broadcast "spot opened" email is sent to this entry, so an already-notified entry isn't re-alerted if another spot opens before they act. |

### **Models & Assignments**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| legacy\_id | String | (Optional) Reference ID to map against the legacy system roster. |
| name | String | Model's display name. |
| contact\_info | String | Private contact details. |

**Session\_Model\_Mapping (Join Table)**

Allows multiple models per session.

* session\_id (Foreign Key)  
* model\_id (Foreign Key)

### **Model Payout Reports**

| Field | Type | Description |
| :---- | :---- | :---- |
| id | UUID | Primary Key |
| model\_id | UUID | Foreign Key to the model being paid. |
| week\_start\_date | Date | Start of the reporting week. |
| week\_end\_date | Date | End of the reporting week. |
| sessions\_worked | Integer | Count of sessions this model worked in the period. |
| rate\_applied | Decimal | The `MODEL_FLAT_PAY_RATE` value in effect at generation time — stored explicitly so a later rate change (Section 12.1) doesn't silently rewrite historical payout amounts. |
| total\_owed | Decimal | sessions\_worked × rate\_applied. |
| generated\_at | DateTime | When the weekly report was generated/emailed (Section 10). |

## **14\. Open Questions & Next Steps (To Be Defined)**

* **Model Roster Synchronization:** Because models are interacting with a separate legacy system (Phase 1), how will the new system maintain an accurate, up-to-date database of available models for the Model Booker and Admins to assign? (e.g., Will it require manual double-entry of new models, periodic CSV imports, or an API bridge?)  
* **Future Model Portal (Phase 2):** What are the necessary features and requirements for eventually retiring the legacy system and bringing the model-facing request portal directly into this application?

*Document Version: 1.2*

*Last Updated: August 14, 2026*