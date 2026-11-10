/**
 * Batches in the remaining admin-creatable static pages (src/lib/cms/slugify.ts's
 * /pages/[slug] mechanism — see migrations/1786931227330 for the original
 * home/about/contact rows and the Admin-creatable static pages implementation
 * notes in CLAUDE.md). Content sourced from the live lifedrawing.org site via
 * a 2026-03-22 archive snapshot (the live site was down when this was written —
 * see the Static-only launch mode notes for why this didn't wait on it).
 *
 * Deliberately NOT included here — flagged for a human decision, not a
 * technical gap:
 * - Board Members: names/emails/bios change with elections, needs a fresh
 *   check against the current board before publishing, not a snapshot.
 * - Memorials: sensitive personal content about real deceased individuals
 *   and their families — needs explicit sign-off, not a batch insert.
 * - Board Archives, 40th Anniversary Booklet: both are mostly links to PDFs
 *   (meeting minutes, bylaws, the booklet itself) that would need re-uploading
 *   through /ops/cms/uploads first — a file-migration task, not a content one.
 * - Gallery Showings: long historical show list, source page paginates
 *   ("show more") past what this snapshot captured — partial by construction.
 *
 * Also note: Become a Volunteer's live page lists specific currently-open
 * positions (time-sensitive as of the snapshot date) — intentionally
 * omitted rather than reproduced stale. How to Use Robostrar's live copy
 * referenced COVID-era reopening policy and a defunct "Basic Inquiry Online"
 * streaming offering — both dropped as dead weight, not reproduced.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO static_pages (slug, title, content) VALUES
    ('getting-here', 'Getting Here', $content$## Where to Find Us

1011 Main Street
Vancouver, BC V6A 4L4
604.681.2855
basic@lifedrawing.org

## How to Get There

**By Transit:** Skytrain to Main & Terminal and walk North along Main Street.

**By Bike:** The closest bike path is Quebec.

**By Car:** From downtown: Take Georgia East to exit Main Street, turn right into Main Street and Basic will be located on the right side.

## Where to Park

Street parking on Main Street is available from 7 pm on as well as pay parking at various lots around the block.$content$),

    ('code-of-conduct', 'Code of Conduct', $content$*Revised May 6, 2025*

By attending a session at Basic Inquiry, a participant agrees to the following Rules of Conduct (the Rules). Violators of the Rules are subject to Correction, Warning, and/or a Temporary or Permanent Ban, at the sole discretion of the Board of Directors.

- No photography of the model of any kind. Participants may photograph their work in the gallery area before or after a session.
- Participants will follow the session manager's instructions, including leaving the studio if asked to do so.
- Participants will respect the wishes and requests of the models and not interrupt or disrupt the model's work. Not all models wish to be social while working and we ask that you respect this.
- Participants will endeavor to register for each session in advance and to arrive at the studio early enough to set up prior to the start of the session.
- Participants will treat models, session managers and other participants courteously and respectfully.
- Participants will bring concerns about the model, the session or other participants to the attention of the session manager.
- Each participant is entitled to one drawing donkey or easel. Participants may use more than one donkey or easel only if there are leftover donkeys once all attendees have arrived.
- Participants will refrain from disruptive conversation or activity while the model is posing.
- Participants will respect the space. They will clean their work area after use and dispose of any refuse. Participants will not damage any facilities and will not remove any equipment from the studio.
- Participants will not come into the studio when suffering from a contagious illness.

## Enforcement Responsibilities

Basic Inquiry leaders are responsible for clarifying and enforcing these standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful. Basic Inquiry leaders have the right and responsibility to address participants who do not adhere to this Code of Conduct, and will take steps to remove any participant who shows a pattern of violating these rules.$content$),

    ('become-a-model', 'Become a Model', $content$Basic Inquiry is interested in hiring models of all types. If you are a model at least 19 years old and looking for work, please send a request by e-mail to [our model bookers](mailto:basicinquirymodels@gmail.com). Be sure to include the following four items:

1. A description of your prior modeling experience. If you've never modeled, describe any relevant experience you have that informs your desire to model.
2. A description of your general availability. We usually book a month in advance and tend to "try out" new model candidates less frequently than that. Please apply only if you have more than short-term availability.
3. Two well-lit color photographs of yourself: one head shot and one full body pose, ideally in a swimsuit or tight clothing. Do not send nude photographs, paintings, or drawings of yourself.
4. A photograph of a government-issued identification document showing your face, full name, and date of birth.

If you include all four, you will hear from us shortly. If you can't provide all four components of an application, we are likely not interested in your availability. Thanks!

We are especially interested in reliable art models who have some experience and, especially, who are able to do dynamic short poses. If you are interested in modeling but have no experience, please attend one of our sessions as a drop-in artist to learn more about it before applying.

New models, or models new to Basic, should also read the [New Model Orientation Guide](/pages/new-model-orientation).$content$),

    ('become-a-volunteer', 'Become a Volunteer', $content$The Vancouver Life Drawing Society is a volunteer-run organization.

We depend on volunteer efforts to provide services to our members and other artists interested in the figurative arts. Volunteering is a great way to learn new skills. Our positions include various standing positions to help us maintain the studio and our sessions, our website and social media, and our gallery space. They also include members of the Board of Directors, who are renewed each AGM from the pool of willing volunteers, and appointed as needed between AGMs when positions become open.

To volunteer for these and any other positions, you must be a Member of the Society in good standing. If interested in more information, please send an email to the current board.

## Board Positions

The Board consists of the following positions, which are served over the course of 1 year:

- President & Vice President (2 positions)
- Secretary
- Treasurer
- Member at Large (2-3 positions)$content$),

    ('faq', 'FAQ', $content$### How do I register for a session?

Visit [Robostrar](https://www.scratchconsortium.com/alain2020/robostrar/) to create an account and register for sessions.

### Can I use one of my tickets to admit a friend or family member?

No, tickets are non-transferrable. Guests must sign up through Robostrar and purchase their own session tickets.

### Can I purchase a ticket or gift card for my friend or family member?

No, Basic Inquiry does not have a gift card option, and tickets are non-transferrable. However, if your friend has a Robostrar account, you may pay for their tickets securely using your own credit or debit card when they check out.

### Can I get a receipt?

To generate a receipt for your purchase, log in to Robostrar and click the "History" tab at the top of the menu. This will show all of your recent activity within Robostrar.

Using the dates on the left, determine which order you want to generate a receipt for. It will read "You paid for order #1234", where the order number represents your unique order.

Click the blue order number to generate a receipt in a new tab.

To print to a PDF or printer, press Ctrl+P to open the print dialog menu.

### What do I need to bring to the studio with me, first time I come?

We provide easels and drawing horses, drawing boards and clips, and we usually — though not always — have a stash of newsprint from which you can help yourself to a few sheets. Please bring your own mark-making material and your preferred paper or canvas; count on us for drawing boards and furniture. Note: if you're painting, we allow only odour-free solvents in the studio.

### What are the formats of Gesture, Regular, and Long Pose sessions?

All sessions are three-hours with several breaks.

- **Gesture**: A session is composed of many short, dynamic poses. This session is great for fast anatomy study and repetitive drawing exercise.
- **Long Pose**: A session is composed of only one pose, to which the model returns after each break. This is great for paintings or more detailed and developed studies.
- **Regular**: sessions mix poses of varying lengths — some short, some fast.

### Is there any guided instruction during the sessions?

Our main sessions are uninstructed, so there is no formal guidance. Usually attendance is about 10-20 people per session, in a mix of new and experienced artists, as well as of newcomers to our studio and long-standing regular attendees. The environment is pretty supportive and while you should not count on formal guidance of course you are welcome to ask questions at break of other artists whose work you admire. Though drawing happens in silence, the breaks are usually pretty energetic, and a good time to meet people.

Basic Inquiry does offer occasional workshops run by members of the society. The cost of these will vary by instructor. The best way to learn about these special events is by subscribing to our social media feed @basicinquiry on Facebook and Instagram, or visiting the studio and looking for event posters.

### Do you have advice for creating and submitting a formal portfolio?

At any point in time, some good fraction of our participants are pursuing exactly this quest. We are an excellent place to practice for, and ultimately develop, portfolio pieces, but institutionally, we do not provide suggestions or help with you in thinking about the overall editorial composition of any portfolio you might be preparing. It's not unlikely you could meet someone at Basic who would have ideas about that, and who may be willing to offer them either out of friendship or for a fee, but that is not any part of our services or sessions.

### Is there a minimum age requirement to attend a session?

We have no age restrictions -- we are open to aspiring artists of all ages. If you are serious in your intent you are welcome here. We do require that participants follow our [code of conduct](/pages/code-of-conduct). And in order to register for a session, you will need to acquire tickets, which requires both an account on our online system and a credit card with which to purchase tickets.$content$),

    ('how-to-use-robostrar', 'How to Use Robostrar', $content$Robostrar is the electronic registration and sales system that facilitates Basic Inquiry's operations, and was launched at the 2021 AGM.

Robostrar is designed to permit you, as a participant in the local drawing community, to:

1. Create an account (personal login id and password) for your electronic transactions with Basic Inquiry. This permits us to offer you e-commerce, communicate with you about your needs and purchases, and identify your presence in our studio sessions for attendance record needs.
2. Purchase electronic tickets for studio sessions, individually or in packs, with multi-ticket discounts if you buy bulk and much lower prices if you become a Society Member.
3. Register for actual studio sessions using tickets or drawing passes.
4. Make other electronic purchases, including Annual Memberships (if you are not already a member, or have a recently-expired membership), and "unlimited monthly drawing passes" (if you are already a member).

The first of these activities -- signing up for your own account -- happens only once, the first time you use Robostrar. After that, log in to your existing account to access any of the other activities.

The majority of your use of Robostrar will be in step 3, finding sessions to attend and signing up for them. Occasionally you'll circle back to step 2 to renew your supply of tickets. And once a year you might go to step 4 to renew your membership!

Robostrar is straightforward, and has been designed to be easy to use without detailed written instructions. Please [visit Robostrar](https://www.scratchconsortium.com/alain2020/robostrar/) and give it a try.

*Note: Robostrar's tickets and passes apply to studio sessions only -- real-life in-person sessions conducted in our studio.*$content$),

    ('new-model-orientation', 'New Model Orientation', $content$If you're new to modeling at Basic Inquiry:

## Scheduling

You must confirm your scheduled session by text or e-mail with the Model Booker one day before your Session. If you know you cannot make a future scheduled session for any reason, please contact the Model Booker ASAP. If you do not confirm a booked session the day before, the Model Booker may assume you've forgotten your appointment, and schedule a different model. This may also happen if you come late to your session: you may be replaced by a different model. In these events, you will not be paid for your session. The success of Basic depends on the reliability of our models, so please take your commitments seriously.

## Session format

Your session will be moderated by a Session Manager, who can help orient you to the Studio and your job. You'll model for three hours including breaks. Depending on the day of the week, your format may involve many short poses (Gesture Poses), one long pose (Long Pose Sessions), or a variety of short and medium length poses (Regular Sessions).

Sessions should start on time, and you should be on the model stand and striking your first pose at the beginning of your session hour. So give yourself enough time beforehand to prepare, change out of your clothes, and be ready to begin work then. Sessions end on time as well. Assume you can be out the door 5 or 10 minutes past the hour at which your posing stops.

## Start

Arrive at least five minutes before your session starts and introduce yourself to the Session Manager, and ask about pose timings and other requirements for your session. If you are unconfident about timing yourself, ask the Session Manager to time you during your poses.

## Platform

Check that the brakes on the (wheeled) modeling platform are locked before your session, especially if you are planning any active poses.

## Props

There are a variety of stools and poles available for your use as props in longer poses, as well as pillows and cushions. (Ask the Session Manager if you don't see these.) Please bring your own sheet or covering for your sitting and reclining poses, since we cannot launder our props after each session.

In addition to the poles, we have books, wine glasses, a fake pistol, and hand fan to use during posing if desired. You are also welcome to bring your own small props from home.

A rope hangs down from the ceiling to the model stand that you can use to hold your arms in position for a longer period of time. However, for your safety, we ask that you do not place a lot of weight on this rope! Take a pose you can fall from.

## Breaks

Long poses will be punctuated by breaks, and every session features a long break (20 minutes) halfway through. For your first several sessions, check in with the Session Manager on the long break about your posing and ask for feedback. Not all session managers are "active communicators;" you taking the initiative in asking whether things are going well, or whether there are things you could be better doing differently, will help insure you get the feedback you need for comfortable, successful sessions.

## Pay

You'll be paid our regular rate, by e-transfer, within a week after the end of your session, and you also earn the contents of a tip jar. Tips depend both on how many artists attend your session and how generous they're feeling, but session tips on the order of $5-$10 aren't uncommon.

## Privacy and your body

Basic Inquiry prides itself on maintaining a safe and comfortable environment for your work. Artists keep a respectful distance from models; people who are not artists are not allowed to observe sessions. Only the Session Manager is permitted to direct the model. Photography of models is strictly prohibited at Basic. If you have any questions or concerns about these policies or actual practices, please bring them to the attention of your Session Manager, the Model Booker, or any member of the Board of Directors.

If you're new to modeling in general:

## Clothing

All poses are nude (except during the Special Costumed Sessions), but for their own comfort and quick access, many models wear a robe or other light covering before sessions and during breaks, after changing out of their street clothes. You may change from your street clothes in the washroom, and leave your personal belongings in the curtained area in the corner between the sinks.

## Posing

For short poses (5 minutes and under), dynamic poses -- with the body or limbs extended or somewhat off balance -- are more interesting than static ones (very stable, symmetric poses; or reclining poses). For long poses (20 minutes or more), look to support your body and all limbs comfortably in the pose: it's difficult to hold even a lightly flexed muscle steady for more than a few minutes. Even here, contrapposto poses, or poses with some twist to them, are better than symmetric and "straight-ahead" poses. Remember you are being drawn by artists surrounding you on all sides. Vary your poses to face different parts of the room, or even better, twist your pose so that you are facing different parts of the room simultaneously!

## Confidence in your pose

When striking a new pose, especially one in a train of short poses, do not look to the audience of artists for confirmation that "it's an okay pose." Different artists like different things, and what's good on one side may not be so good on another, so feedback from the crowd is often mixed. You decide your poses, not them! Instead, strike your pose confidently and quickly, then hold it. (Even if it's not the best possible pose, a steady pose is more enjoyable to draw than when you decide to "adjust yourself" 30 seconds after people start drawing.) For longer poses, work with Session Manager to identify a pose that's both comfortable for you and satisfying for the audience.

## Breaking a Pose

Of course, if you are having real difficulty with a pose -- especially a long one -- you have the right to stop it at any time. In such situations, some models find that by stretching a muscle or shaking out a limb mid-pose, they can resume the pose for the remainder of the period. But if you need to abort a pose, do so. Your own safety is more important than artists' drawings.$content$),

    ('resources', 'Resources', $content$## Art Galleries in the Vancouver Area

- [Vancouver Art Gallery](https://www.vanartgallery.bc.ca/)
- [Federation of Canadian Artists](https://www.artists.ca/)

## Art Instruction in the Vancouver Area

Schools offering diploma and degree programs often have continuing education courses you can enroll in individually. Also, individual art instructors often offer private classes which they advertise with brochures at art supply stores and art schools.

- [Capilano University Fine & Applied Arts](https://www.capilanou.ca/ce/north-shore/fine-applied-arts/)
- [Emily Carr University of Art and Design](https://www.ecuad.ca/)
- [Federation of Canadian Artists](https://www.artists.ca/)
- [Langara College Creative & Applied Arts](https://www.langara.bc.ca/creative-arts/index.html)
- [Malaspina Printmakers Society](https://www.malaspinaprintmakers.com/)
- [University of British Columbia Department of Art History, Visual Art and Theory](https://www.ahva.ubc.ca/)

## Art Supplies & Framing

- [DeSerres](https://www.deserres.ca/)
- [Opus Framing & Art Supplies](https://www.opusframing.com/)

## Artists on the Internet

Many of the associations and organizations listed on this page also have links to artists' web sites.

- [Canadian-Artist.com](https://canadian-artist.com/)

## Associations & Organizations

- [Alliance for Arts and Culture](https://www.allianceforarts.com/)
- [CARFAC (Canadian Artists' Representation/le Front des artistes canadiens)](https://www.carfac.ca/)
- [CCAF (Chinese Canadian Artist Federation)](https://www.ccaf-vancouver.com/ccaf_home_eng.htm)
- [North Shore Artists' Guild](https://nsartists.ca/)

## Calls for Submission

- [Alliance for Arts and Culture (Greater Vancouver)](https://www.allianceforarts.com/)

## Magazines & Newsletters

A selection of print and online material -- some free, some by paid subscription:

- [American Artist Magazine](https://www.myamericanartist.com/)
- [The Artist's Magazine](https://www.artistsmagazine.com/)$content$)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM static_pages WHERE slug IN (
      'getting-here', 'code-of-conduct', 'become-a-model', 'become-a-volunteer',
      'faq', 'how-to-use-robostrar', 'new-model-orientation', 'resources'
    );
  `);
};
