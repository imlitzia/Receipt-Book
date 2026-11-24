/* Receipt Book: turns text read from a receipt photo into expense fields.
   Works on Japanese and English receipts. Pure functions, no network. */
(function (root) {
  'use strict';

  var CJK = '぀-ヿ㐀-鿿ｦ-ﾟ';
  var CATS = ['Groceries', 'Eating out', 'Transport', 'Shopping', 'Home & utilities', 'Health',
    'Fun & hobbies', 'Bills & subscriptions', 'Travel', 'Other'];

  /* Known chains: [pattern, display name, category] */
  var SHOPS = [
    [/セブン.?イレブン|7.?eleven|seven.?eleven/i, 'Seven-Eleven', 'Eating out'],
    [/ローソン|lawson/i, 'Lawson', 'Eating out'],
    [/ファミリーマート|familymart|ファミマ/i, 'FamilyMart', 'Eating out'],
    [/ミニストップ|ministop/i, 'Ministop', 'Eating out'],
    [/デイリーヤマザキ/, 'Daily Yamazaki', 'Eating out'],
    [/スターバックス|starbucks/i, 'Starbucks', 'Eating out'],
    [/ドトール|doutor/i, 'Doutor', 'Eating out'],
    [/タリーズ|tully/i, "Tully's Coffee", 'Eating out'],
    [/マクドナルド|mcdonald/i, "McDonald's", 'Eating out'],
    [/すき家/, 'Sukiya', 'Eating out'],
    [/吉野家/, 'Yoshinoya', 'Eating out'],
    [/松屋/, 'Matsuya', 'Eating out'],
    [/サイゼリヤ/, 'Saizeriya', 'Eating out'],
    [/ガスト/, 'Gusto', 'Eating out'],
    [/イオン|aeon/i, 'AEON', 'Groceries'],
    [/西友|seiyu/i, 'Seiyu', 'Groceries'],
    [/イトーヨーカドー/, 'Ito-Yokado', 'Groceries'],
    [/まいばすけっと/, 'My Basket', 'Groceries'],
    [/業務スーパー/, 'Gyomu Super', 'Groceries'],
    [/ライフ/, 'Life', 'Groceries'],
    [/サミット/, 'Summit', 'Groceries'],
    [/成城石井/, 'Seijo Ishii', 'Groceries'],
    [/オーケー|okストア/i, 'OK Store', 'Groceries'],
    [/マツモトキヨシ|matsukiyo/i, 'Matsumoto Kiyoshi', 'Health'],
    [/ウエルシア|welcia/i, 'Welcia', 'Health'],
    [/スギ薬局/, 'Sugi Pharmacy', 'Health'],
    [/ツルハ/, 'Tsuruha Drug', 'Health'],
    [/ココカラ/, 'Cocokara Fine', 'Health'],
    [/ダイソー|daiso/i, 'Daiso', 'Shopping'],
    [/セリア/, 'Seria', 'Shopping'],
    [/ユニクロ|uniqlo/i, 'Uniqlo', 'Shopping'],
    [/無印良品|muji/i, 'Muji', 'Shopping'],
    [/ニトリ|nitori/i, 'Nitori', 'Home & utilities'],
    [/ビックカメラ|bic\s?camera/i, 'Bic Camera', 'Shopping'],
    [/ヨドバシ|yodobashi/i, 'Yodobashi Camera', 'Shopping'],
    [/ドン.?キホーテ|don.?quijote/i, 'Don Quijote', 'Shopping'],
    [/trader\s?joe/i, "Trader Joe's", 'Groceries'],
    [/whole\s?foods/i, 'Whole Foods', 'Groceries'],
    [/costco|コストコ/i, 'Costco', 'Groceries'],
    [/walmart/i, 'Walmart', 'Groceries'],
    [/safeway|kroger/i, 'Supermarket', 'Groceries'],
    [/\bcvs\b|walgreens/i, 'Pharmacy', 'Health'],
    [/eneos|エネオス|出光|コスモ石油/i, 'Gas station', 'Transport']
  ];

  var CAT_WORDS = [
    ['Eating out', /レストラン|食堂|カフェ|珈琲|コーヒー|喫茶|居酒屋|ラーメン|寿司|焼肉|定食|弁当|cafe|coffee|restaurant|bistro|diner|bar\b|grill|pizza|burger/i],
    ['Groceries', /スーパー|マーケット|青果|精肉|鮮魚|食品|supermarket|grocery|market/i],
    ['Transport', /タクシー|交通|駅|鉄道|バス|駐車|ガソリン|給油|乗車券|切符|taxi|parking|fuel|gasoline|railway|metro|transit/i],
    ['Health', /薬局|ドラッグ|病院|医院|クリニック|歯科|調剤|pharmacy|drug|clinic|hospital|dental/i],
    ['Home & utilities', /電気料金|ガス料金|水道|ホームセンター|家具|utility|hardware/i],
    ['Travel', /ホテル|旅館|航空|宿泊|hotel|inn\b|airline|airport/i],
    ['Fun & hobbies', /書店|本屋|映画|シネマ|カラオケ|ゲーム|美術館|博物館|cinema|theater|theatre|books?tore|museum|karaoke/i],
    ['Shopping', /衣料|ファッション|電器|雑貨|百貨店|家電|apparel|clothing|electronics|department/i]
  ];

  var MONEY_SRC = '([-△▲]\\s?)?([¥$€£]\\s?)?(\\d{1,3}(?:[,.]\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)(?![\\d.,])(?!\\s?(?:kg|g\\b|ml|cm|mm|l\\b|本|枚|入|袋|パック|号|cc))(\\s?円)?';

  function toHalf(s) {
    return s.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ').replace(/[￥]/g, '¥').replace(/[−–—]/g, '-');
  }

  function cleanLine(line) {
    var l = toHalf(line);
    // OCR often puts spaces between Japanese characters; join them.
    var re = new RegExp('([' + CJK + '])\\s+(?=[' + CJK + '])', 'g');
    l = l.replace(re, '$1');
    // ¥ is often read as "Y" or "\" right before digits.
    l = l.replace(/(^|[\s:(])[Y\\](?=\s?\d)/g, '$1¥');
    // OCR often splits thousands: "1, 540", "1 ,540", "1. 540", or "¥1 540" → 1,540
    l = l.replace(/(\d)\s*[,.]\s+(?=\d{3}(?!\d))/g, '$1,').replace(/(\d)\s+[,.]\s*(?=\d{3}(?!\d))/g, '$1,');
    l = l.replace(/([¥$€£]\s?\d{1,3})\s(?=\d{3}(?![\d.,]))/g, '$1,').replace(/(\d{1,3})\s(?=\d{3}\s?円)/g, '$1,');
    return l.replace(/\s+/g, ' ').trim();
  }

  /* Remove things that look like numbers but are not money. */
  function stripNonMoney(l) {
    return l
      .replace(/(20\d{2}|令和\s?\d{1,2}|R\s?\d{1,2})\s*[年\/.\-]\s*\d{1,2}\s*[月\/.\-]\s*\d{1,2}\s*日?/g, ' ')
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ')
      .replace(/\b\d{2}[\/.]\d{1,2}[\/.]\d{1,2}\b/g, ' ')
      .replace(/\d{1,2}\s*[:時]\s*\d{2}(\s*[:分]\s*\d{2})?/g, ' ')
      .replace(/\(?\d{2,4}\)?[\-\s]\d{2,4}-\d{3,4}/g, ' ')
      .replace(/\bT\s?\d{13}\b/g, ' ')
      .replace(/\d+(\.\d+)?\s*%/g, ' ')
      .replace(/[x×X＊*]\s*\d{1,3}\s*(個|点|コ)?(?=\s|$)/g, ' ')
      .replace(/\d{1,3}\s*(個|点|コ|品)/g, ' ')
      .replace(/(^|\s)\d{1,3}\s?@\s?[\d.,]+/g, ' ')
      .replace(/No\.?\s*\d+|#\s*\d+|レジ\s*\d+|責\s*\d+/gi, ' ');
  }

  function toNumber(tok) {
    var neg = /^-/.test(tok) || /△|▲/.test(tok);
    var t = tok.replace(/[^\d.,]/g, '');
    if (!t) return null;
    var n;
    if (/^\d{1,3}([.,]\d{3})+$/.test(t)) n = parseFloat(t.replace(/[.,]/g, ''));
    else if (/^\d+[.,]\d{1,2}$/.test(t)) n = parseFloat(t.replace(',', '.'));
    else if (/^\d+$/.test(t)) n = parseInt(t, 10);
    else n = parseFloat(t.replace(/,/g, ''));
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  /* Money amounts on a line, left to right. */
  function amounts(line) {
    var l = stripNonMoney(line);
    var out = [], m;
    var re = new RegExp(MONEY_SRC, 'g');
    while ((m = re.exec(l))) {
      var digits = m[3].replace(/\D/g, '');
      if (digits.length > 8) continue;
      var v = toNumber((m[1] || '') + m[3]);
      if (v === null) continue;
      out.push({ v: v, sym: !!(m[2] || m[4]) });
    }
    return out;
  }
  function lastAmount(line) { var a = amounts(line); return a.length ? a[a.length - 1].v : null; }

  var RX = {
    total: /(総\s?合\s?計|税込\s?合\s?計|合\s?計|お会計|御会計|お買上げ?\s?(計|金額)|お支払い?\s?(金額|額|合計)?|ご請求額|領収金額|^計\b|grand\s?total|amount\s?due|balance\s?due|\btotal\b)/i,
    notTotal: /(小\s?計|subtotal|sub\s?total|対象|点数|預|釣|change|tender|ポイント|point)/i,
    tax: /(内?消費税等?|内税|外税|税額|\btax\b|\bvat\b|\bgst\b)/i,
    skipItem: /(計|税|預|釣|お買上|ポイント|point|total|tax|change|cash|card|visa|master|jcb|amex|tender|balance|領収|レシート|登録番号|tel|電話|〒|担当|レジ|no\.|お支払|クレジット|現金|電子マネー|paypay|suica|pasmo|残高|値引対象|対象)/i,
    shopSkip: /(領収|レシート|receipt|tel|電話|〒|登録番号|いらっしゃいませ|ありがとう|毎度|welcome|thank|本日|営業時間|www\.|http|\.com|\.jp)/i,
    discount: /(値引|割引|クーポン|discount|coupon)/i
  };

  function findDate(text, today) {
    var t = toHalf(text), m, y, mo, d;
    if ((m = t.match(/令和\s?(\d{1,2}|元)\s?年\s?(\d{1,2})\s?月\s?(\d{1,2})\s?日/))) {
      y = 2018 + (m[1] === '元' ? 1 : +m[1]); mo = +m[2]; d = +m[3];
    } else if ((m = t.match(/(20\d{2})\s?[年\/.\-]\s?(\d{1,2})\s?[月\/.\-]\s?(\d{1,2})/))) {
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else if ((m = t.match(/\bR\s?(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{1,2})\b/))) {
      y = 2018 + +m[1]; mo = +m[2]; d = +m[3];
    } else if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/))) {
      // English style: month/day/year, or day/month/year when the first number is over 12.
      y = +m[3]; mo = +m[1]; d = +m[2];
      if (mo > 12) { var s = mo; mo = d; d = s; }
    } else if ((m = t.match(/\b(\d{2})[\/.](\d{1,2})[\/.](\d{1,2})\b/))) {
      y = 2000 + +m[1]; mo = +m[2]; d = +m[3];
    } else if ((m = t.match(/(\d{1,2})\s?月\s?(\d{1,2})\s?日/))) {
      y = +String(today || '').slice(0, 4) || new Date().getFullYear(); mo = +m[1]; d = +m[2];
    }
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  function findTime(text) {
    var m = toHalf(text).match(/(?:^|[^\d])([01]?\d|2[0-3])\s?[:時]\s?([0-5]\d)(?:\s?[:分]\s?\d{2})?\s?(am|pm|午前|午後)?/i);
    if (!m) return null;
    var h = +m[1], ap = (m[3] || '').toLowerCase();
    if ((ap === 'pm' || ap === '午後') && h < 12) h += 12;
    if ((ap === 'am' || ap === '午前') && h === 12) h = 0;
    return ('0' + h).slice(-2) + ':' + m[2];
  }

  function findPayment(text) {
    var t = toHalf(text);
    if (/paypay|楽天ペイ|d払い|au\s?pay|line\s?pay|メルペイ|qr|バーコード決済/i.test(t)) return 'QR pay (PayPay etc.)';
    if ((/suica|pasmo|icoca|交通系|nanaco|waon|edy|quicpay|電子マネー/i.test(t)||/\biD\b/.test(t))) return 'IC card (Suica etc.)';
    if (/クレジット|credit|visa|master|jcb|amex|american express|diners/i.test(t)) return 'Credit card';
    if (/デビット|debit/i.test(t)) return 'Debit card';
    if (/現金|お預り|お預かり|cash/i.test(t)) return 'Cash';
    return null;
  }

  function findCurrency(text, fallback) {
    if (/円|¥|￥/.test(text)) return 'JPY';
    if (/€|\bEUR\b/.test(text)) return 'EUR';
    if (/£|\bGBP\b/.test(text)) return 'GBP';
    if (/\$|\bUSD\b/.test(text)) return fallback && /USD|AUD|CAD|NZD|SGD|HKD|TWD/.test(fallback) ? fallback : 'USD';
    if (/(^|\s)\d+\.\d{2}(\s|$)/m.test(text) && /^(JPY|KRW|VND|IDR)$/.test(fallback || 'JPY')) return 'USD';
    return fallback || 'JPY';
  }

  function parseReceipt(text, opts) {
    opts = opts || {};
    var raw = String(text || '').split(/\r?\n/);
    var lines = raw.map(cleanLine).filter(function (l) { return l.length > 0; });
    var flat = lines.join('\n');
    var squashed = flat.replace(/\s+/g, '');
    var r = { merchant: null, date: null, time: null, total: null, tax: null, payment: null,
      category: null, items: [], currency: null, found: [] };

    r.currency = findCurrency(flat, opts.currency);
    r.date = findDate(flat, opts.today);
    r.time = findTime(flat);
    r.payment = findPayment(flat);

    // Shop: a known chain anywhere, otherwise the first line that reads like a name.
    var shopCat = null, shopIdx = -1, i;
    for (i = 0; i < SHOPS.length; i++) {
      if (SHOPS[i][0].test(squashed)) { r.merchant = SHOPS[i][1]; shopCat = SHOPS[i][2]; break; }
    }
    for (i = 0; i < Math.min(lines.length, 8); i++) {
      var l = lines[i];
      var letters = (l.match(new RegExp('[A-Za-z' + CJK + ']', 'g')) || []).length;
      var digits = (l.match(/\d/g) || []).length;
      if (letters >= 2 && letters >= digits && l.length <= 32 && !RX.shopSkip.test(l) && !RX.total.test(l)) {
        shopIdx = i;
        if (!r.merchant) r.merchant = l.replace(/^[^A-Za-z0-9぀-鿿]+|[^A-Za-z0-9぀-鿿)）]+$/g, '');
        break;
      }
    }

    // Total: keyword lines (amount on the line or the next one); else the largest plausible amount.
    var cands = [], firstTotalIdx = -1;
    lines.forEach(function (l, idx) {
      if (RX.total.test(l) && !RX.notTotal.test(l)) {
        if (firstTotalIdx < 0) firstTotalIdx = idx;
        var a = lastAmount(l);
        if (a === null && lines[idx + 1] && !RX.notTotal.test(lines[idx + 1])) a = lastAmount(lines[idx + 1]);
        if (a !== null && a > 0) cands.push(a);
      }
      if (firstTotalIdx < 0 && /(小\s?計|subtotal)/i.test(l)) firstTotalIdx = idx;
    });
    if (cands.length) r.total = Math.max.apply(null, cands);
    else {
      var best = null;
      lines.forEach(function (l) {
        if (RX.notTotal.test(l)) return;
        amounts(l).forEach(function (a) { if (a.v > 0 && (best === null || a.v > best)) best = a.v; });
      });
      r.total = best;
    }

    // Tax: amount after the tax word, summed over 8% and 10% lines.
    var tax = 0, taxSeen = false;
    lines.forEach(function (l) {
      var m = l.match(RX.tax);
      if (!m) return;
      if (/税込\s?合計|税抜|対象額のみ/.test(l) && !/内?消費税|内税|外税|税額/.test(l.replace(/税込\s?合計/, ''))) return;
      var after = l.slice(m.index + m[0].length);
      var a = amounts(after);
      var v = a.length ? a[0].v : null;
      if (v !== null && v > 0 && (!r.total || v < r.total * 0.25)) { tax += v; taxSeen = true; }
    });
    if (taxSeen) r.tax = Math.round(tax * 100) / 100;

    // Items: lines between the shop name and the first total/subtotal line that end in an amount.
    var end = firstTotalIdx > 0 ? firstTotalIdx : lines.length;
    for (i = shopIdx + 1; i < end; i++) {
      var line = lines[i];
      if (RX.skipItem.test(line) && !RX.discount.test(line)) continue;
      var price = lastAmount(line);
      if (price === null || price === 0) continue;
      var name = stripNonMoney(line)
        .replace(new RegExp(MONEY_SRC, 'g'), ' ')
        .replace(/[¥$€£@*※軽]+/g, ' ').replace(/\s+/g, ' ').trim();
      if ((name.match(new RegExp('[A-Za-z' + CJK + ']', 'g')) || []).length < 1) continue;
      var q = toHalf(line).match(/[x×X＊*]\s*(\d{1,3})(?:\s*(個|点|コ))?(?=\s|$)|(\d{1,3})\s*(個|点|コ)|(?:^|\s)(\d{1,3})\s?@/);
      var qty = q ? +(q[1] || q[3] || q[5]) : 1;
      if (RX.discount.test(line) && price > 0) price = -price;
      if (r.total && Math.abs(price) > r.total * 1.01) continue;
      r.items.push({ name: name.slice(0, 60), qty: qty || 1, price: price });
    }

    // Category: from a known chain, else from words on the receipt.
    r.category = shopCat;
    if (!r.category) {
      for (i = 0; i < CAT_WORDS.length; i++) if (CAT_WORDS[i][1].test(flat)) { r.category = CAT_WORDS[i][0]; break; }
    }

    ['merchant', 'date', 'time', 'total', 'tax', 'payment', 'category'].forEach(function (k) { if (r[k] !== null && r[k] !== undefined) r.found.push(k); });
    if (r.items.length) r.found.push('items');
    r.text = lines.join('\n');
    return r;
  }

  var api = { parseReceipt: parseReceipt, CATS: CATS, _amounts: amounts, _findDate: findDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReceiptParser = api;
})(this);
