// ═══════════════════════════════════════════════════════════════════════
//  SUPPORT INBOX SNAPSHOT
//
//  Conversation threads behind the Support Inbox in the Customer Support
//  tab. Same population as support-data.js (City of Torrance residents,
//  last 30 days, user_role=user): one entry per Intercom conversation with
//  its message thread.
//
//  Message roles: resident (the org's resident), ai (Rec's Fin AI agent),
//  agent (Rec support teammate). Internal Rec staff notes are private and
//  are excluded here and in the live client — never shown to orgs.
//  Bodies are HTML-stripped; long AI answers lightly trimmed for display.
//  A few older threads carry only the opening message.
//
//  When INTERCOM_ACCESS_TOKEN is set, intercom-live.js serves this same
//  shape from the live Intercom REST API and this snapshot is bypassed.
// ═══════════════════════════════════════════════════════════════════════

const SUPPORT_INBOX = {
  torrance:
[
 {
  "id": "215475210214081",
  "subject": "Forgot password",
  "contact": {
   "name": "Marlene Abe",
   "email": "ohanaabe@gmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1784848000,
  "updatedAt": 1784850359,
  "topic": "Account & Login",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Pls allow me to choose a new password",
  "messages": [
   {
    "role": "resident",
    "name": "Marlene Abe",
    "at": 1784848000,
    "text": "Pls allow me to choose a new password"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784848025,
    "text": "Hello,\nYou can choose a new password by resetting it from the login page.\n• Go to the Rec login screen and select Forgot Password.\n• Enter the email address linked to your account.\n• Check your inbox for the reset email and open the secure link inside it.\n• You'll be taken to a page where you can create a new password.\nAfter signing in, you can also update your password anytime in your profile. If you don't see the reset email, check your spam or junk folder."
   },
   {
    "role": "agent",
    "name": "Jennel Rossetti",
    "at": 1784850326,
    "text": "Hello Marlene, thanks for reaching out. I have sent you a password reset. I hope this helps!\nBest,\nJennel - Rec Support Team"
   }
  ]
 },
 {
  "id": "215475191978298",
  "subject": "PICKLEBALL class registration for August 18",
  "contact": {
   "name": "Sharon Lotesto",
   "email": "sanddbeach@sbcglobal.net"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1784746753,
  "updatedAt": 1784833354,
  "topic": "Registration & Enrollment",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Hi,\n \n \n I signed up for the August 18 class that's at 10:30 at Wilson park but not sure it went through. \n \n …",
  "messages": [
   {
    "role": "resident",
    "name": "Sharon Lotesto",
    "at": 1784746753,
    "text": "Hi,\n \n \n I signed up for the August 18 class that's at 10:30 at Wilson park but not sure it went through. \n \n \n My name is Sharon Lotesto. Please let me know.\n \n \n Thank you,\n Sharon"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784746773,
    "text": "Hi Sharon,\nYou can quickly confirm whether your registration went through in two ways:\n• Check your email: After completing payment, a confirmation email is sent with the booking details.\n• Check your Schedule: Sign in and open your reservations — this page shows all of your upcoming and past bookings.\nIf the class appears in your Schedule, your registration was successful."
   }
  ]
 },
 {
  "id": "215475181026192",
  "subject": "Re: Instructor Payout 2026-07-20-Patrick Corley",
  "contact": {
   "name": "Patrick Corley",
   "email": "pmck2001@aol.com"
  },
  "channel": "Email",
  "state": "open",
  "createdAt": 1784683781,
  "updatedAt": 1784745888,
  "topic": "Instructor Payout",
  "resolution": "Handled by Staff",
  "finInvolved": false,
  "preview": "Thanks Lindsey,\n\nWhat exactly is the split for a single Summer Camp golfer? I don't remember discussing this b…",
  "messages": [
   {
    "role": "resident",
    "name": "Patrick Corley",
    "at": 1784683781,
    "text": "Thanks Lindsey,\n\nWhat exactly is the split for a single Summer Camp golfer? I don't remember discussing this before our first camp last year. Thanks\n\nSent from AOL on Android\n \n On Mon, Jul 20, 2026 at 10:19 PM, Instructor Support\n<instructors@rec.us> wrote:\n \n Hi Patrick,\n\nHope you are doing well. Please see attached for an adjusted payout. Before remitting your payment we noticed that our payout formula hadn't properly split the camp you and Christian taught together. See those adjustments reflected here and let us know if you have any questions! \n\nBest,\nLindsay"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784683786,
    "text": "Hello Patrick!\nThanks for reaching out! Our instructor support team will be in touch with you shortly."
   }
  ]
 },
 {
  "id": "215475177846026",
  "subject": "Lesson Booking",
  "contact": {
   "name": "Max Starr",
   "email": "mstarr9954@gmail.com"
  },
  "channel": "Email",
  "state": "open",
  "createdAt": 1784665330,
  "updatedAt": 1784690682,
  "topic": "Registration & Enrollment",
  "resolution": "Handled by Staff",
  "finInvolved": false,
  "preview": "Good afternoon, my name is Max Starr and I was just added into the roster as a music teacher for the City of T…",
  "messages": [
   {
    "role": "resident",
    "name": "Max Starr",
    "at": 1784665330,
    "text": "Good afternoon, my name is Max Starr and I was just added into the roster as a music teacher for the City of Torrance. I have watched all the instruction videos but I just wanted to make sure I understood lesson booking correctly. \n\nFrom what I understand, to create private lessons, there is a create a lesson slot on my profile page. By clicking on that I can see the available locations and its available times to teach. Once I create a time slot, it is open to the public and anyone can schedule lessons that I have made a slot for. From there it is just a matter of confirming bookings and preparing for the lesson. \n\nDid I understand that correctly? If there is anything I may have missed please let me know and thank you for your time!"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784665336,
    "text": "Hello Max!\nThanks for reaching out! Our instructor support team will be in touch with you shortly."
   },
   {
    "role": "agent",
    "name": "Nazarena",
    "at": 1784690682,
    "text": "Hi Max, Welcome to the team!\nYes, you understood the process correctly.\nAnyways, I'll always be available to help if you have any trouble creating lesson slots from your side or if you have any questions along the way. Just let me know, and I'd be happy to assist.\nThank you!\nBest,\nNazarena\nTeam Rec"
   }
  ]
 },
 {
  "id": "215475163551478",
  "subject": "Missing Payment?",
  "contact": {
   "name": "Desiree Glover",
   "email": "thepharoah369@yahoo.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1784574061,
  "updatedAt": 1784661448,
  "topic": "Payments & Billing",
  "resolution": "Handled by Staff",
  "finInvolved": false,
  "preview": "Greetings,\nI show a July 8th [5:30-6p] class taught to Aranyani, but it didn't pay out?!? \n\nRemember: Fasten Y…",
  "messages": [
   {
    "role": "resident",
    "name": "Desiree Glover",
    "at": 1784574061,
    "text": "Greetings,\nI show a July 8th [5:30-6p] class taught to Aranyani, but it didn't pay out?!? \n\nRemember: Fasten Your Seatbelt In The Back Seat...Toss God The Keys...\"Let God Drive\"!!! \nBe Well & Stay Blessed, \nDez 'The Pharoah' Glover\n[Coach Dez]\nhttps://online.publuu.com/578867/1305118"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784574066,
    "text": "Hello Desiree!\nThanks for reaching out! Our instructor support team will be in touch with you shortly."
   }
  ]
 },
 {
  "id": "215475140850730",
  "subject": "Next pay",
  "contact": {
   "name": "Christine Massa",
   "email": "cmassa.pickleball@gmail.com"
  },
  "channel": "Email",
  "state": "open",
  "createdAt": 1784386515,
  "updatedAt": 1784581162,
  "topic": "Instructor Payout",
  "resolution": "Handled by Staff",
  "finInvolved": false,
  "preview": "Hi, \nI was on vacation in June but started back to teaching in July. When is my next pay schedule? July 7 & 14…",
  "messages": [
   {
    "role": "resident",
    "name": "Christine Massa",
    "at": 1784386515,
    "text": "Hi, \nI was on vacation in June but started back to teaching in July. When is my next pay schedule? July 7 & 14 are complete.\n\nChristine Massa\nTorrance"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784386520,
    "text": "Hello Christine!\nThanks for reaching out! Our instructor support team will be in touch with you shortly."
   },
   {
    "role": "agent",
    "name": "Nazarena",
    "at": 1784581162,
    "text": "Hi Christine,\nYour next payment should arrive in your account today. Please let us know if you have any questions or need any assistance.\nThank you.\nBest,\nTeam Rec"
   }
  ]
 },
 {
  "id": "215475087445803",
  "subject": "Adult Passes for lap swimming purchased in error",
  "contact": {
   "name": "Mark Hirabayashi",
   "email": "mark.hirabayashi@gmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1784073381,
  "updatedAt": 1784075556,
  "topic": "Refunds & Cancellations",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Hi,\n\nI recently mistakenly paid $100.00 for 22 adult passes when I meant to purchase 22 Senior passes. I calle…",
  "messages": [
   {
    "role": "resident",
    "name": "Mark Hirabayashi",
    "at": 1784073381,
    "text": "Hi,\n\nI recently mistakenly paid $100.00 for 22 adult passes when I meant to purchase 22 Senior passes. I called the City of Torrance and was told I could not cancel that transaction. They suggested I reach out to you to see if the payment could be switched over for Senior passes. I am willing to pay an additional $20.00 to make my total $120.00 for 44 Senior passes. I have not used any of the 22 adult passes yet. Please advise.\n\nThank you,\n\nMark Hirabayashi\n323.854.7559"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784073405,
    "text": "Hi Mark,\nFor City of Torrance passes, refunds and any changes to a purchase (like switching Adult passes to Senior passes) have to be handled by the City of Torrance team, not through Rec.\nSince you've already spoken with the City and they indicated the transaction can't be canceled, the next step is to ask them directly whether they can apply your $100 as a credit toward Senior passes.\nYou can reach the City of Torrance at (310) 618-2930."
   },
   {
    "role": "resident",
    "name": "Mark Hirabayashi",
    "at": 1784074078,
    "text": "Hi Fin,\nI was shocked to receive a reply so quickly! After receiving it, I called the City of Torrance back immediately. Maria said there was nothing they could do on their end internally, and that's why she told her assistant the first time to have me send you an email. I am therefore again reaching out to see if there is anything you can do on your end to help me out to avoid my $40.00 mistake.\nThanks again,\nMark"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784074100,
    "text": "Hi Mark,\nUnfortunately, for City of Torrance passes, any refund or change to a purchase has to be handled by the City of Torrance team, not through Rec. It may be worth asking them specifically if they can apply the $100 you already paid as account credit toward the 44 Senior passes, and then you can pay the additional $20 to make up the difference.\nIf they do issue credit, you can use it at checkout by selecting \"Apply eligible credits.\""
   },
   {
    "role": "resident",
    "name": "Mark Hirabayashi",
    "at": 1784074239,
    "text": "Hi Fin,\nThanks again. I'll give it a shot.\nMahalo,\nMark"
   }
  ]
 },
 {
  "id": "215475081810174",
  "subject": "Changing Direct Deposit",
  "contact": {
   "name": "Hao Chun Chen",
   "email": "ianchen1031@gmail.com"
  },
  "channel": "Email",
  "state": "open",
  "createdAt": 1784046135,
  "updatedAt": 1784838595,
  "topic": "Instructor Payout",
  "resolution": "Handled by Staff",
  "finInvolved": false,
  "preview": "Hi,\n\nI would like to change my direct deposit, could you help with that please?\n\nThank you,Hao Chun (Ian) Chen",
  "messages": [
   {
    "role": "resident",
    "name": "Hao Chun Chen",
    "at": 1784046135,
    "text": "Hi,\n\nI would like to change my direct deposit, could you help with that please?\n\nThank you,Hao Chun (Ian) Chen"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1784046140,
    "text": "Hello Hao!\nThanks for reaching out! Our instructor support team will be in touch with you shortly.\nIn the meantime check out our Instructor Guide that answers some frequently asked instructor questions."
   },
   {
    "role": "agent",
    "name": "Lindsay Keare",
    "at": 1784689192,
    "text": "Hi Hao,\nHope you're doing well. Please look at this link to change your direct deposit details.\nBest,\nLindsay"
   },
   {
    "role": "resident",
    "name": "Hao Chun Chen",
    "at": 1784731239,
    "text": "Thank you! When I try to add a debit card, I get this message. Any way around it? [image]\nThank you,\nIan Chen"
   },
   {
    "role": "resident",
    "name": "Hao Chun Chen",
    "at": 1784838594,
    "text": "Hi,\nAny update on this?"
   }
  ]
 },
 {
  "id": "215475069428845",
  "subject": "Swimming Class Level Change",
  "contact": {
   "name": "Tsendsuren Pansan",
   "email": "adushinka@yahoo.com"
  },
  "channel": "Chat",
  "state": "closed",
  "createdAt": 1783975679,
  "updatedAt": 1784049483,
  "topic": "Refunds & Cancellations",
  "resolution": "Escalated to Staff",
  "finInvolved": true,
  "preview": "Hello, I registered for swimming class for my children but I made a mistake for choosing levels. Is this possi…",
  "messages": [
   {
    "role": "resident",
    "name": "Tsendsuren Pansan",
    "at": 1783975679,
    "text": "Hello, I registered for swimming class for my children but I made a mistake for choosing levels. Is this possible to change now?"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783975700,
    "text": "Yes, you can change it, but right now the way to do that is to cancel the current class/session and then re-register for the correct level.\nTo cancel:\n• Log in at rec.us\n• Go to Reservations (or Schedule)\n• Open the session under Upcoming Bookings\n• Tap Cancel Reservation and confirm\nAfter it's canceled, you can sign up again for the right level."
   },
   {
    "role": "resident",
    "name": "Tsendsuren Pansan",
    "at": 1783975783,
    "text": "Do I get back my full refund if I cancel the classes"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783975794,
    "text": "Not necessarily, Tsendsuren. Refunds depend on the Parks and Recreation department that runs the class, and some cities only allow refunds if you cancel within a certain number of days before the class starts.\nAlso, even when a refund is allowed, it may not be the full amount: a small payment processor transaction fee can apply."
   },
   {
    "role": "resident",
    "name": "Tsendsuren Pansan",
    "at": 1784048708,
    "text": "Can I get your phone number?"
   },
   {
    "role": "resident",
    "name": "Tsendsuren Pansan",
    "at": 1784048719,
    "text": "I need to talk real assistant"
   },
   {
    "role": "agent",
    "name": "Jennel Rossetti",
    "at": 1784049450,
    "text": "Hello Tsendsuren,\nThank you for contacting Rec support! I'm happy to help.\nFor any questions related to programming managed by Torrance, you can reach out to the Torrance Recreation Services team.\n• Aquatics – JFerneau@Torranceca.gov\nI'm CCing them in here. If the matter is urgent you can call them at: (310) 618-2930!\nBest,\nJennel - Rec Support Team"
   }
  ]
 },
 {
  "id": "215475066028850",
  "subject": "Tennis class payment",
  "contact": {
   "name": "Amy Miyamoto",
   "email": "amy4mail@msn.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1783962311,
  "updatedAt": 1784048922,
  "topic": "Payments & Billing",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "I am in a tennis class given by City of Torrance. On June 28, 9:30 am I took the first class and on July and 2…",
  "messages": [
   {
    "role": "resident",
    "name": "Amy Miyamoto",
    "at": 1783962311,
    "text": "I am in a tennis class given by City of Torrance. On June 28, 9:30 am I took the first class and on July and 2nd class on July 12. The instructor (Marcin Kosakowski) notified me that I was not registered and have not paid for it yet. I would like \n\nto pay for the whole session due ($100). How can I do this.\n\nAmy Miyamoto\n\nSent from my iPad"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783962342,
    "text": "Hi Amy,\nYou can pay directly from your Rec account, as long as there's an unpaid invoice tied to the class.\nHere are the steps:\n• Sign in, then go to Schedule.\n• Find the class/session showing an unpaid invoice (it may be at the bottom of the list).\n• Open the reservation details and select Make Payment, then follow the prompts.\nIf you do not see an unpaid invoice in your account, the City of Torrance Parks and Recreation team can help confirm your registration and payment options at (310) 618-2930."
   }
  ]
 },
 {
  "id": "215475047869879",
  "subject": "No Residency Badge in Rec",
  "contact": {
   "name": "Michael Contreras",
   "email": "mjcontreras310@gmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1783810624,
  "updatedAt": 1784604748,
  "topic": "Residency Verification",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Hello,\n\ncontacting per request of Torrance Facility booking. Recently booked an event at a Torrance park and o…",
  "messages": [
   {
    "role": "resident",
    "name": "Michael Contreras",
    "at": 1783810624,
    "text": "Hello,\n\ncontacting per request of Torrance Facility booking. Recently booked an event at a Torrance park and only the non-resident rate was applied. \n\nHoping you can assist with the residency badge. Thank you!\n\nMEMBER REC ID: IFMK86"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783810650,
    "text": "Hello,\nIf you're a Torrance resident but only the non-resident rate applied, it usually means your residency badge (resident verification) isn't showing on your profile yet.\nYou can check this by signing in and going to Profile → Active Group Memberships to see whether a resident group is listed there.\nIf you don't see the residency badge there, you can reach out to the City of Torrance directly for assistance with residency verification."
   },
   {
    "role": "agent",
    "name": "Mike",
    "at": 1783810864,
    "text": "Hello Michael,\nThank you for contacting Rec support! I'm happy to help.\nFor any questions related to residency managed by Torrance, you can reach out to the Torrance Recreation Services team.\nI'm CCing them in here. If the matter is urgent you can call them at: (310) 618-2930!"
   },
   {
    "role": "resident",
    "name": "Michael Contreras",
    "at": 1783810977,
    "text": "Thanks for the reply!\nI'm not seeing those groups in my profile — so I assume it's not configured. I've already reached out to the city of Torrance (did so initially) and then contacted you per their auto response.\nI will await their reply now.\nThanks again."
   },
   {
    "role": "agent",
    "name": "Mike",
    "at": 1783811080,
    "text": "No problem\nWe unfortunately aren't authorized to mark you as a resident. The city has to approve it.\nShould be sorted out once you reach them!\nMike"
   },
   {
    "role": "resident",
    "name": "Michael Contreras",
    "at": 1783811212,
    "text": "No worries. Thank you again!\nHope to get some assistance from the city soon."
   }
  ]
 },
 {
  "id": "215474968701004",
  "subject": "Changing email associated with account",
  "contact": {
   "name": "Elysa Shatz",
   "email": "elysa3@gmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1783289489,
  "updatedAt": 1783313490,
  "topic": "Account & Login",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Hello,\n\nI would like to change the email associated with my Torrance Rec account. I was unable to do so online…",
  "messages": [
   {
    "role": "resident",
    "name": "Elysa Shatz",
    "at": 1783289489,
    "text": "Hello,\n\nI would like to change the email associated with my Torrance Rec account. I was unable to do so online. Is this something you can help me with?\n\nThank you \nElysa"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783289520,
    "text": "Hi Elysa,\nAt the moment, the email address on a Rec account cannot be changed from the profile editor. The profile settings allow updates to items like your name, address, photo, and password, but the email itself is not editable there.\nIf you need the email updated, you can request assistance by emailing support@rec.us with a brief description of the request."
   },
   {
    "role": "agent",
    "name": "Mike",
    "at": 1783313456,
    "text": "Hello Elysa,\nMike here from the Rec team. If you'd like to change the email associated with your account please reach out to the Torrance Community Services team at enroll@torranceca.gov and they can help you out.\nBest,\nMike"
   }
  ]
 },
 {
  "id": "215474968681693",
  "subject": "Changing email",
  "contact": {
   "name": "Elysa Shatz",
   "email": "elysa3@gmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1783289227,
  "updatedAt": 1783289479,
  "topic": "Account & Login",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Hi,\n\nI would like to change my email address associated with my account. I was unable to do this on my account…",
  "messages": [
   {
    "role": "resident",
    "name": "Elysa Shatz",
    "at": 1783289227,
    "text": "Hi,\n\nI would like to change my email address associated with my account. I was unable to do this on my account. Is there a way to change this?\n\nThank you\nElysa Shatz"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783289324,
    "text": "Hi Elysa,\nAt the moment, changing the email address on your Rec account isn't something you can do yourself in your profile. The profile editor only lets you update items like your name, address, profile photo, and password.\nIf you no longer have access to the email address currently linked to your account, the next step is to email our support team at support@rec.us so they can help update it for you."
   },
   {
    "role": "resident",
    "name": "Elysa Shatz",
    "at": 1783289430,
    "text": "Yes thank you!"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783289477,
    "text": "Hi Elysa,\nIf you have any more questions or need further assistance, feel free to ask."
   }
  ]
 },
 {
  "id": "215474966148683",
  "subject": "Ticket purchase eligibility",
  "contact": {
   "name": "Satoshi Kozaki",
   "email": "satoshikozaki66@gmail.com"
  },
  "channel": "Chat",
  "state": "closed",
  "createdAt": 1783264221,
  "updatedAt": 1783265048,
  "topic": "Registration & Enrollment",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "[image]\n[image]\nI am unable to buy a ticket https://torrance.rec.us/events/bc6b7659-bace-48da-95d1-dd019a0d782…",
  "messages": [
   {
    "role": "resident",
    "name": "Satoshi Kozaki",
    "at": 1783264221,
    "text": "[image]\n[image]\nI am unable to buy a ticket https://torrance.rec.us/events/bc6b7659-bace-48da-95d1-dd019a0d7829 as it shows an error. It shows \"You do not meet eligibility requirements\nMember of A - City of Torrance\" although my account is verified as Torrance resident. Can you help me to fix it?"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783264231,
    "text": "I'll connect you with someone who can assist further. Meanwhile, could you share any additional details about the issue to help them understand your situation better?"
   },
   {
    "role": "resident",
    "name": "Satoshi Kozaki",
    "at": 1783264259,
    "text": "I already shared them."
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783264273,
    "text": "Satoshi, that error usually means the event is checking a specific eligibility rule (in your case, \"Member of A - City of Torrance\") and something in the booking flow isn't matching what the event expects, even if your profile shows you're verified.\nA couple quick things to try:\n• Refresh the page, then try adding to cart again.\n• Double check your profile details are accurate (especially address), since bookings pull from your profile.\nIf it still blocks you after that, this needs a local Parks and Recreation administrator to review and manually grant permission for that event."
   },
   {
    "role": "resident",
    "name": "Satoshi Kozaki",
    "at": 1783264613,
    "text": "I checked my profile again and found no problem."
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783264627,
    "text": "Satoshi, thanks for confirming. Since your profile looks correct, this is most likely an eligibility rule on the event that isn't matching what the event expects during checkout, even though you're verified as a Torrance resident.\nAt this point, the next step is to have the local Parks and Recreation administrator review it and manually grant permission for that event.\nFor City of Torrance, you can email: enroll@torranceca.gov.\nWhen you email, include the event link, the exact error text, and your screenshots so they can review quickly."
   }
  ]
 },
 {
  "id": "215474936328672",
  "subject": "Add a camper?",
  "contact": {
   "name": "Christian Donahue",
   "email": "christiand485@gmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1783011651,
  "updatedAt": 1783098256,
  "topic": "Registration & Enrollment",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "We had a request today to add another one day camper to our camp . It's full, but we have space for one more i…",
  "messages": [
   {
    "role": "resident",
    "name": "Christian Donahue",
    "at": 1783011651,
    "text": "We had a request today to add another one day camper to our camp . It's full, but we have space for one more in the regular camp slot. .- would it be possible to create a link for one day drop in camper, and send to Irene Ahuja at 949 422 1447. The camper is Jordan Ahuja.\n\nThanks- and sorry for the short notice, she just called me!\n\nChristian"
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1783011675,
    "text": "Hi Christian,\nI understand you need to add a one-day drop-in camper to your camp and want to send a registration link to the parent.\nWe can't create or send the link on your behalf, but you can set up a private booking link for that extra camper and share it directly with the parent.\nTo do this:\n• Go to your Instructor Dashboard and create a new slot.\n• Enter the camp details and set visibility to Private link only.\n• Choose the correct date and time.\n• Click Copy booking link, then text it to the parent so they can complete registration."
   }
  ]
 },
 {
  "id": "215474926332142",
  "subject": "Re: Sign in to Rec",
  "contact": {
   "name": "Lynne Kuraoka",
   "email": "lkuraoka@hotmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1782958992,
  "updatedAt": 1783016465,
  "topic": "Account & Login",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "I can't seem to log in with my password so I can't add more money to my account.",
  "messages": [
   {
    "role": "resident",
    "name": "Lynne Kuraoka",
    "at": 1782958992,
    "text": "I can't seem to log in with my password so I can't add more money to my account."
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1782959017,
    "text": "Hi,\nYou can still get into your account without using your password by using the email sign-in link.\nOn the login screen, choose Log in with your email, enter the email address on your Rec account, and use the secure link we send to sign in. If you do not see the email, check your spam or junk folder.\nOnce you're signed in, you can change your password in your profile."
   },
   {
    "role": "agent",
    "name": "Jennel Rossetti",
    "at": 1783016430,
    "text": "Hello Lynne, thanks for reaching out. I have sent you a password reset to your email. I hope this helps!\nBest,\nJennel - Rec Support Team"
   }
  ]
 },
 {
  "id": "215474922145005",
  "subject": "Re: Important Update Regarding Today's Tennis Class",
  "contact": {
   "name": "Simon Lee",
   "email": "yaz2131@yahoo.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1782932389,
  "updatedAt": 1783020313,
  "topic": "Refunds & Cancellations",
  "resolution": "Escalated to Staff",
  "finInvolved": true,
  "preview": "I am sure you understand parents' frustration about today. However, it is not just the irresponsible schedulin…",
  "messages": [
   {
    "role": "resident",
    "name": "Simon Lee",
    "at": 1782932389,
    "text": "I am sure you understand parents' frustration about today. However, it is not just the irresponsible scheduling and communication. We were also just informed that the instructor is not who is listed on the website for this class. He was not the one who showed up the first day and now we're told anybody can show up for the remainder of the camp. This is not what was advertised and what we were looking for when signing up. This is also on top of what now sounds like last minute staffing due to the scheduling confusion. I am sure you understand our frustration with not getting what we signed up for for our kids. We are hereby requesting a refund for this camp. Please respond with confirmation. Thank you."
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1782932438,
    "text": "Hi,\nRefunds are handled under your city partner's policy. You can request the refund in either of these ways:\n• Log in to your Rec account and submit a refund request from your booking.\n• Or email support@rec.us with your booking details and request a refund.\nGiven the circumstances you've described, I'd recommend including details about the instructor mismatch and today's missed class when you submit your refund request."
   },
   {
    "role": "resident",
    "name": "Simon Lee",
    "at": 1782933073,
    "text": "Thank you for the general reply, but didn't my original email requesting a refund go to support@rec.us? Will someone else besides you be replying to me specifically about the refund?\nI also tried the second option you indicated below. However, I don't see the \"Cancel Reservation\" button — I am assuming because the camp already started?\nSo basically, I already emailed support@rec.us with the refund request — do I need to do anything else?"
   },
   {
    "role": "agent",
    "name": "Nazarena",
    "at": 1782933895,
    "text": "Hi Simon,\nWe completely understand your frustration and sincerely apologize for today's incident.\nWe will process a full refund for the camp, and you will receive a confirmation once it has been completed.\nAgain, we are very sorry for the inconvenience.\nBest regards,\nRec Team"
   }
  ]
 },
 {
  "id": "215474909389710",
  "subject": "Refund request",
  "contact": {
   "name": "Don Kwak",
   "email": "dontavich@hotmail.com"
  },
  "channel": "Chat",
  "state": "closed",
  "createdAt": 1782857956,
  "updatedAt": 1782967978,
  "topic": "Refunds & Cancellations",
  "resolution": "Escalated to Staff",
  "finInvolved": true,
  "preview": "Hello,\nmade a reservation for badminton for 6/28 4-8pm but when I showed up, receptionist told me that there i…",
  "messages": [
   {
    "role": "resident",
    "name": "Don Kwak",
    "at": 1782857956,
    "text": "Hello,\nmade a reservation for badminton for 6/28 4-8pm but when I showed up, receptionist told me that there is no badminton play scheduled and roller rink is using by hockey. She told me to call or email for refund request."
   },
   {
    "role": "ai",
    "name": "Fin",
    "at": 1782857973,
    "text": "Sorry that happened, Don. For a refund request, the next step is to check the refund policy for the city that runs that facility (it's listed on your booking receipt or confirmation email).\nThen you can request the refund either by logging into your Rec account and submitting the refund request, or by emailing support@rec.us with your booking details and the reason (court not available)."
   },
   {
    "role": "resident",
    "name": "Don Kwak",
    "at": 1782858007,
    "text": "talk to the team"
   },
   {
    "role": "agent",
    "name": "Nazarena",
    "at": 1782965792,
    "text": "Hi Don Kwak,\nThank you so much for reaching out, and we're so sorry about that. We weren't informed that it was a hockey game instead of the badminton class. We'll process your refund right away.\nCould you please provide the email address associated with your account so we can complete the refund? Thank you!\nBest,\nTeam Rec"
   },
   {
    "role": "resident",
    "name": "Don Kwak",
    "at": 1782966561,
    "text": "Hello,\nThank you for the reply.\nMy email address associated with the account is dontavich@hotmail.com\nThank you,\nDon Kwak"
   },
   {
    "role": "agent",
    "name": "Nazarena",
    "at": 1782967928,
    "text": "Thank you so much Don Kwak, I already issued the refund to your bank account.\nBest,\nTeam Rec"
   }
  ]
 },
 {
  "id": "215474894099128",
  "subject": "Fwd: Booking cancelled: Private Swim Lessons – All Ages 06/21/26 at Victor E. Benstead Plunge",
  "contact": {
   "name": "Laxmi Reddy Singareddy",
   "email": "lsingareddy@gmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1782769506,
  "updatedAt": 1782856116,
  "topic": "Refunds & Cancellations",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Hi Rec Team,\n\nI have cancelled this calls but didn't receive any credit, if I am not eligible to get refund at…",
  "messages": [
   {
    "role": "resident",
    "name": "Laxmi Reddy Singareddy",
    "at": 1782769506,
    "text": "Hi Rec Team,\n\nI have cancelled this calls but didn't receive any credit, if I am not eligible to get refund at least should have notified me in that case we should have taken class but did not mentioned anywhere like that, going forward I will make sure will take care of it please excuse this time and can get credit to my account that would be great. \n\nRegards, \nLaxmi"
   }
  ]
 },
 {
  "id": "215474894084866",
  "subject": "Fwd: Booking cancelled: Youth Swim Lessons - Level 2 06/20/26 at Victor E. Benstead Plunge",
  "contact": {
   "name": "Laxmi Reddy Singareddy",
   "email": "lsingareddy@gmail.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1782769428,
  "updatedAt": 1782856037,
  "topic": "Refunds & Cancellations",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Hi Rec Team,\n\nI have cancelled this calls but didn't receive any credit, if I am not eligible to get refund at…",
  "messages": [
   {
    "role": "resident",
    "name": "Laxmi Reddy Singareddy",
    "at": 1782769428,
    "text": "Hi Rec Team,\n\nI have cancelled this calls but didn't receive any credit, if I am not eligible to get refund at least should have notified me in that case we should have taken class but did not mentioned anywhere like that, going forward I will make sure will take care of it please excuse this time and can get credit to my account that would be great. \n\nRegards,\nLaxmi\n\nRe"
   }
  ]
 },
 {
  "id": "215474877666720",
  "subject": "Class No Show",
  "contact": {
   "name": "Tsendsuren Pansan",
   "email": "adushinka@yahoo.com"
  },
  "channel": "Chat",
  "state": "closed",
  "createdAt": 1782661855,
  "updatedAt": 1782662427,
  "topic": "Registration & Enrollment",
  "resolution": "Resolved by AI",
  "finInvolved": true,
  "preview": "Hello I registered my son for the morning sunday tennis class 8:30-9:30am. We came here and nobody was there c…",
  "messages": [
   {
    "role": "resident",
    "name": "Tsendsuren Pansan",
    "at": 1782661855,
    "text": "Hello I registered my son for the morning sunday tennis class 8:30-9:30am. We came here and nobody was there can you tell me what happened to my sons class. His name is Bayar Erdene."
   }
  ]
 },
 {
  "id": "215474858677903",
  "subject": "Benjamin Cruz",
  "contact": {
   "name": "Yecenia Cruz",
   "email": "yeceniacruz@aol.com"
  },
  "channel": "Email",
  "state": "closed",
  "createdAt": 1782489472,
  "updatedAt": 1782763918,
  "topic": "Other",
  "resolution": "Handled by Staff",
  "finInvolved": false,
  "preview": "Hello,\n\nI have two sessions for swimming for Benjamin Cruz. We need to cancel. Looks like that class is to adv…",
  "messages": [
   {
    "role": "resident",
    "name": "Yecenia Cruz",
    "at": 1782489472,
    "text": "Hello,\n\nI have two sessions for swimming for Benjamin Cruz. We need to cancel. Looks like that class is to advance for him. We thought it was level 3. Can you please cancel both sessions. Will I be getting a credit or back to my credit card? \n\nThank you in advance \n\nYecenia Cruz? \n\nSent from my iPhone"
   }
  ]
 }
],
};

function getSupportInbox(orgSlug) {
  const list = SUPPORT_INBOX[orgSlug];
  if (!list) return null;
  // List view: everything except message bodies
  return list.map(({ messages, ...rest }) => ({ ...rest, messageCount: messages.length }));
}

function getSupportThread(orgSlug, id) {
  const list = SUPPORT_INBOX[orgSlug];
  if (!list) return null;
  return list.find(c => c.id === String(id)) || null;
}

module.exports = { SUPPORT_INBOX, getSupportInbox, getSupportThread };
