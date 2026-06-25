/**
 * Quote Widget — Jerad · Ops
 *
 * iOS Scriptable widget that pulls one random quote (weighted by
 * resurface_weight) from the dashboard and displays it in a Readwise-
 * style card. Tap to open the quote in the dashboard.
 *
 * Setup:
 *   1. Open Scriptable on iPhone, create a new script, paste this whole file in.
 *   2. Set the two constants below (API_BASE and WIDGET_SECRET).
 *   3. Long-press home screen → + → Scriptable → Medium widget.
 *      Edit it → choose this script → Tap "When Interacting" → Open URL.
 *   4. The widget reads `widget.url` on tap, which we set to the deep link
 *      returned by the API.
 *
 * Refresh: iOS controls widget refresh timing (~ every 15-60 minutes
 * at iOS's discretion), but we also hint a 3-hour cadence to the system
 * so it doesn't burn battery refreshing more aggressively than needed.
 */

// ─── CONFIG ─────────────────────────────────────────────────────────────
// Edit these two values. Don't commit them anywhere.
const API_BASE = 'https://api.dashboard.jeradhill.com';
const WIDGET_SECRET = 'PASTE_YOUR_WIDGET_SECRET_HERE';
// ────────────────────────────────────────────────────────────────────────

// ─── Visual tokens (Readwise-ish dark card) ─────────────────────────────
const BG = new Color('#1C1C1E');
const QUOTE_COLOR = new Color('#FFFFFF');
const META_COLOR = new Color('#B5B5BB');
const META_DIM_COLOR = new Color('#8E8E93');
const ACCENT_COLOR = new Color('#B8442B');
const QUOTE_FONT = Font.semiboldSystemFont(15);
const SOURCE_TITLE_FONT = Font.boldSystemFont(13);
const SOURCE_AUTHOR_FONT = Font.systemFont(12);
const FOOTER_FONT = Font.mediumSystemFont(9);

// ─── main ──────────────────────────────────────────────────────────────
const quote = await fetchQuote();
const widget = await buildWidget(quote);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();

// ─── helpers ───────────────────────────────────────────────────────────

async function fetchQuote() {
  const url = `${API_BASE}/api/widget/quote?secret=${encodeURIComponent(WIDGET_SECRET)}`;
  const req = new Request(url);
  req.method = 'GET';
  req.timeoutInterval = 10;
  try {
    const data = await req.loadJSON();
    return data?.item ?? null;
  } catch (err) {
    console.log(`fetchQuote failed: ${err}`);
    return null;
  }
}

async function buildWidget(quote) {
  const widget = new ListWidget();
  widget.backgroundColor = BG;
  widget.setPadding(14, 14, 12, 14);
  // Refresh budget hint — iOS treats this as a "don't refresh before"
  // not a guarantee. Real cadence is iOS's call but this discourages
  // sooner-than-needed re-runs.
  widget.refreshAfterDate = new Date(Date.now() + 3 * 60 * 60 * 1000);

  if (!quote) {
    const err = widget.addText('Couldn’t load a quote.');
    err.font = Font.mediumSystemFont(13);
    err.textColor = META_COLOR;
    err.centerAlignText();
    return widget;
  }

  // Tap → open the quote in the dashboard.
  if (quote.href) widget.url = quote.href;

  // ─── Quote body — takes the top portion ────────────────────────────
  const quoteText = widget.addText(`“${quote.text}”`);
  quoteText.font = QUOTE_FONT;
  quoteText.textColor = QUOTE_COLOR;
  // No font scaling — iOS truncates with ellipsis when text overflows
  // the available space. Server pre-truncates at ~360 chars; long quotes
  // can still hit the wall if line breaks land awkwardly, so this is the
  // safety net.
  quoteText.lineLimit = 7;

  widget.addSpacer();

  // ─── Source row — left: cover or glyph · right: title + author ────
  const sourceRow = widget.addStack();
  sourceRow.layoutHorizontally();
  sourceRow.centerAlignContent();
  sourceRow.spacing = 10;

  await renderLeftBadge(sourceRow, quote);

  const sourceText = sourceRow.addStack();
  sourceText.layoutVertically();
  sourceText.spacing = 1;

  const title = sourceText.addText(sourceTitle(quote));
  title.font = SOURCE_TITLE_FONT;
  title.textColor = QUOTE_COLOR;
  title.lineLimit = 1;

  const author = sourceText.addText(sourceAuthor(quote));
  author.font = SOURCE_AUTHOR_FONT;
  author.textColor = META_COLOR;
  author.lineLimit = 1;

  sourceRow.addSpacer();

  // Footer dot — accent rust mark in the bottom-right corner, echoing
  // the dashboard's single-accent discipline. Quiet but unmistakable.
  const footerRow = sourceRow.addStack();
  footerRow.layoutVertically();
  const dot = footerRow.addText('●');
  dot.font = FOOTER_FONT;
  dot.textColor = ACCENT_COLOR;

  return widget;
}

// Left badge: book cover image, OR a glyph for video/podcast/etc., OR
// nothing if none of the above. ~44px square.
async function renderLeftBadge(parent, quote) {
  const SIZE = 44;
  // 1. Book cover wins.
  const coverUrl = quote.book?.cover_image_url ?? null;
  if (coverUrl) {
    try {
      const img = await new Request(coverUrl).loadImage();
      const imgEl = parent.addImage(img);
      imgEl.imageSize = new Size(SIZE, SIZE * 1.4);
      imgEl.cornerRadius = 3;
      return;
    } catch (err) {
      console.log(`cover fetch failed: ${err}`);
      // fall through to glyph
    }
  }

  // 2. Source-type glyph (SF Symbol). Falls back to a generic quote
  // mark when the source_type is unknown.
  const symbolName = glyphFor(quote.source_type);
  const glyph = SFSymbol.named(symbolName);
  if (glyph) {
    glyph.applyFont(Font.systemFont(20));
    const glyphImg = parent.addImage(glyph.image);
    glyphImg.imageSize = new Size(SIZE * 0.6, SIZE * 0.6);
    glyphImg.tintColor = META_DIM_COLOR;
  }
}

function glyphFor(sourceType) {
  switch (sourceType) {
    case 'video':        return 'play.rectangle';
    case 'podcast':      return 'mic';
    case 'sermon':       return 'book.closed';
    case 'article':      return 'doc.text';
    case 'conversation': return 'bubble.left.and.bubble.right';
    case 'book':         return 'book.closed';
    case 'other':
    default:             return 'quote.bubble';
  }
}

function sourceTitle(quote) {
  if (quote.book?.title) return quote.book.title;
  if (quote.source_reference) return quote.source_reference;
  return 'Untitled';
}

function sourceAuthor(quote) {
  if (quote.source_author) return quote.source_author;
  if (quote.book?.author) return quote.book.author;
  return '';
}
