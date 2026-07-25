// ═══════════════════════════════════════════════════════════════════════
//  CUSTOMER SUPPORT SNAPSHOT
//
//  Rec runs resident-facing support (email + in-app chat) on behalf of
//  partner orgs. This is the data behind the "Customer Support" dashboard
//  section — one row per resident support conversation.
//
//  Source: Intercom. Rows below are a captured snapshot for City of
//  Torrance covering 2026-06-25 .. 2026-07-25, filtered to contacts whose
//  Organization is city-of-torrance and whose user_role is "user" (i.e.
//  residents, not partner staff — staff conversations are excluded so orgs
//  see only what their residents asked).
//
//  "Topic" is derived: Intercom's own "Issue Type or Tag" is used when the
//  conversation carries one, otherwise the topic is classified from the
//  conversation subject. "Resolution State" collapses Intercom's Fin AI
//  resolution states — assumed_resolution and confirmed_resolution both
//  count as "Resolved by AI"; conversations Fin never touched are
//  "Handled by Staff".
//
//  Replacing this snapshot with a live Intercom pull means swapping
//  getSupportRows() for an API call that emits the same row shape; every
//  widget transform reads these columns and nothing else.
// ═══════════════════════════════════════════════════════════════════════

const SUPPORT_ROWS = {
  torrance: [
  { "Date": "2026-06-26", "Channel": "Email", "Topic": "Other", "Issue Type": "", "Priority": "", "Fin Involved": 0, "Resolution State": "Handled by Staff", "Escalated": 0, "State": "closed", "Time to Close Minutes": 731.4, "Replies": 11, "Help Articles": [] },
  { "Date": "2026-06-28", "Channel": "Chat", "Topic": "Registration & Enrollment", "Issue Type": "Question", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": null, "Replies": 16, "Help Articles": ["Understanding the Location Calendar: Your Key to Planning and Playing Efficiently", "Cancel a booked session"] },
  { "Date": "2026-06-29", "Channel": "Email", "Topic": "Refunds & Cancellations", "Issue Type": "Refunds", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": 28.9, "Replies": 11, "Help Articles": ["Refund Process", "How do I cancel or modify my reservation?", "Account Credit : What it is and How to Use It?"] },
  { "Date": "2026-06-29", "Channel": "Email", "Topic": "Refunds & Cancellations", "Issue Type": "Refunds", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": 28.6, "Replies": 11, "Help Articles": ["Refund Process", "How do I cancel or modify my reservation?"] },
  { "Date": "2026-06-30", "Channel": "Chat", "Topic": "Refunds & Cancellations", "Issue Type": "Refunds", "Priority": "P2 - Medium Priority", "Fin Involved": 1, "Resolution State": "Escalated to Staff", "Escalated": 1, "State": "closed", "Time to Close Minutes": 580.7, "Replies": 29, "Help Articles": ["Refund Process", "How do I cancel or modify my reservation?"] },
  { "Date": "2026-07-01", "Channel": "Email", "Topic": "Refunds & Cancellations", "Issue Type": "Refunds", "Priority": "P2 - Medium Priority", "Fin Involved": 1, "Resolution State": "Escalated to Staff", "Escalated": 1, "State": "closed", "Time to Close Minutes": 26.3, "Replies": 23, "Help Articles": ["Refund Process", "How do I cancel or modify my reservation?", "How do we cancel an enrollment in a class?", "How can I cancel my registration?"] },
  { "Date": "2026-07-01", "Channel": "Email", "Topic": "Account & Login", "Issue Type": "", "Priority": "", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": 140.5, "Replies": 13, "Help Articles": ["Trouble Logging In? Here's What to Do", "What should I do if I'm having trouble logging in or not receiving password reset emails?", "How can I reset my password to log into my account?"] },
  { "Date": "2026-07-02", "Channel": "Email", "Topic": "Registration & Enrollment", "Issue Type": "Request", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": 95.2, "Replies": 10, "Help Articles": ["Send a Private Lesson Link"] },
  { "Date": "2026-07-05", "Channel": "Chat", "Topic": "Registration & Enrollment", "Issue Type": "Help", "Priority": "P2 - Medium Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": null, "Replies": 19, "Help Articles": ["What Information is Required During Booking?", "Encountering Errors During Sign-Up? Here's What to Do", "Viewing/Editing Your Profile"] },
  { "Date": "2026-07-05", "Channel": "Email", "Topic": "Account & Login", "Issue Type": "Request", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": null, "Replies": 13, "Help Articles": ["Trouble Logging In? Here's What to Do", "Viewing/Editing Your Profile"] },
  { "Date": "2026-07-05", "Channel": "Email", "Topic": "Account & Login", "Issue Type": "", "Priority": "", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": null, "Replies": 12, "Help Articles": ["Trouble Logging In? Here's What to Do", "Viewing/Editing Your Profile"] },
  { "Date": "2026-07-11", "Channel": "Email", "Topic": "Residency Verification", "Issue Type": "", "Priority": "", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": null, "Replies": 21, "Help Articles": ["Discounts: What Groups Qualify and How to Access Them", "Viewing/Editing Your Profile", "How do I book a tennis court on the city of Torrance website as a Torrance resident?"] },
  { "Date": "2026-07-13", "Channel": "Email", "Topic": "Payments & Billing", "Issue Type": "Question", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": 28.1, "Replies": 11, "Help Articles": ["Payment Methods on Rec", "Making a Payment on a Booked Class/Session or Reservation/Rental"] },
  { "Date": "2026-07-13", "Channel": "Chat", "Topic": "Refunds & Cancellations", "Issue Type": "Refunds", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Escalated to Staff", "Escalated": 1, "State": "closed", "Time to Close Minutes": 8.9, "Replies": 28, "Help Articles": ["Refund Process", "How do I cancel or modify my reservation?", "Encountering Errors During Sign-Up? Here's What to Do", "Apex Park and Recreation District and Rec: Sign-up FAQ", "Account Credit : What it is and How to Use It?", "Rec Accessibility & ADA Policy", "How do we cancel an enrollment in a class?", "How can I cancel my registration?"] },
  { "Date": "2026-07-14", "Channel": "Email", "Topic": "Instructor Payout", "Issue Type": "", "Priority": "", "Fin Involved": 0, "Resolution State": "Handled by Staff", "Escalated": 0, "State": "open", "Time to Close Minutes": null, "Replies": 13, "Help Articles": [] },
  { "Date": "2026-07-14", "Channel": "Email", "Topic": "Refunds & Cancellations", "Issue Type": "Refunds", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": 3.3, "Replies": 29, "Help Articles": ["Refund Process", "How do I cancel or modify my reservation?"] },
  { "Date": "2026-07-18", "Channel": "Email", "Topic": "Instructor Payout", "Issue Type": "", "Priority": "", "Fin Involved": 0, "Resolution State": "Handled by Staff", "Escalated": 0, "State": "open", "Time to Close Minutes": null, "Replies": 7, "Help Articles": [] },
  { "Date": "2026-07-20", "Channel": "Email", "Topic": "Payments & Billing", "Issue Type": "", "Priority": "", "Fin Involved": 0, "Resolution State": "Handled by Staff", "Escalated": 0, "State": "closed", "Time to Close Minutes": 495.9, "Replies": 12, "Help Articles": [] },
  { "Date": "2026-07-21", "Channel": "Email", "Topic": "Registration & Enrollment", "Issue Type": "", "Priority": "", "Fin Involved": 0, "Resolution State": "Handled by Staff", "Escalated": 0, "State": "open", "Time to Close Minutes": null, "Replies": 9, "Help Articles": [] },
  { "Date": "2026-07-21", "Channel": "Email", "Topic": "Instructor Payout", "Issue Type": "", "Priority": "", "Fin Involved": 0, "Resolution State": "Handled by Staff", "Escalated": 0, "State": "open", "Time to Close Minutes": null, "Replies": 8, "Help Articles": [] },
  { "Date": "2026-07-22", "Channel": "Email", "Topic": "Registration & Enrollment", "Issue Type": "Question", "Priority": "P3 - Low Priority", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": 1.1, "Replies": 11, "Help Articles": ["How to Sign Up for a Program or Activity", "How to view your Payment Receipts"] },
  { "Date": "2026-07-23", "Channel": "Email", "Topic": "Account & Login", "Issue Type": "", "Priority": "", "Fin Involved": 1, "Resolution State": "Resolved by AI", "Escalated": 0, "State": "closed", "Time to Close Minutes": 38.8, "Replies": 13, "Help Articles": ["Trouble Logging In? Here's What to Do", "How can I reset my password to log into my account?", "What should I do if I'm having trouble logging into my account?"] },
  ],
};

// Rows whose Date falls inside [start, end]. Missing bounds are open-ended.
function getSupportRows(orgSlug, { start, end } = {}) {
  const rows = SUPPORT_ROWS[orgSlug];
  if (!rows) return null;
  return rows.filter(r => (!start || r.Date >= start) && (!end || r.Date <= end));
}

module.exports = { SUPPORT_ROWS, getSupportRows };
