/**
 * Replaces the "Content coming soon" placeholders (from
 * 1786931227330_cms-static-pages-and-news.js) with real copy sourced from
 * the live lifedrawing.org site, now that the org's identity is confirmed
 * (see src/lib/org.ts): legal name The Vancouver Life Drawing Society,
 * DBA Basic Inquiry. Deliberately doesn't link the Constitution/Bylaws/
 * Safety Plan/Handbook PDFs yet — nothing's been uploaded through
 * /ops/cms/uploads yet, and a dead link is worse than no link.
 *
 * Also sets CONTACT_FORM_RECIPIENT_EMAIL (blank since it was seeded) to
 * the org's real general-inquiry address — the one operationally
 * meaningful change here, not just page copy.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE static_pages SET title = 'About', content = $content$## Our mission

Basic Inquiry — legally The Vancouver Life Drawing Society — is a not-for-profit, volunteer-run organization providing high-quality life drawing sessions, gallery shows, and educational opportunities. Everyone is welcome, from beginners to seasoned artists.

## Land acknowledgment

We gather on the traditional, ancestral, and unceded territory of the Coast Salish Peoples, including the territories of the xʷməθkʷəy̓əm (Musqueam), Sḵwx̱wú7mesh (Squamish), and səlilwətaɬ (Tsleil-Waututh) Nations.$content$
    WHERE slug = 'about';

    UPDATE static_pages SET title = 'Contact', content = $content$- **Address:** 1011 Main Street, Vancouver, BC V6A 4L4
- **Phone:** 604.681.2855
- **Email:** basic@lifedrawing.org

## Land acknowledgment

We gather on the traditional, ancestral, and unceded territory of the Coast Salish Peoples, including the territories of the xʷməθkʷəy̓əm (Musqueam), Sḵwx̱wú7mesh (Squamish), and səlilwətaɬ (Tsleil-Waututh) Nations.$content$
    WHERE slug = 'contact';

    UPDATE static_pages SET content = $content$A not-for-profit, volunteer-run organization — everyone is welcome, from beginners to seasoned artists.$content$
    WHERE slug = 'home';

    UPDATE system_settings SET value = 'basic@lifedrawing.org' WHERE key = 'CONTACT_FORM_RECIPIENT_EMAIL';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE static_pages SET title = 'About Us', content = $content$# About Us

Content coming soon — edit this page via /ops/cms.$content$
    WHERE slug = 'about';

    UPDATE static_pages SET title = 'Contact', content = $content$# Contact

Content coming soon — edit this page via /ops/cms.$content$
    WHERE slug = 'contact';

    UPDATE static_pages SET content = 'Content coming soon — edit this page via /ops/cms.'
    WHERE slug = 'home';

    UPDATE system_settings SET value = '' WHERE key = 'CONTACT_FORM_RECIPIENT_EMAIL';
  `);
};
