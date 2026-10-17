/* ==========================================================================
   newton-liu.com — the whole of the site's behaviour.

   Page types, told apart by <body data-page="...">:
     work     — the Index: renders the collection cards (renderHome)
     gallery  — renders one collection's justified photo grid + the lightbox
     globe, prose — the landing and About/Contact: only the nav, the
                ground switch and window.NLSite (globe.js draws the landing)

   <body data-base="../../"> is the path back to the repo root, so the same
   script works from / and from /collections/<slug>/. Keep it relative:
   GitHub Pages preview URLs are served from a subpath and absolute paths
   ("/assets/...") break there.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
     CAPTIONS — what, if anything, is printed under a photograph.

     Everything is off: the photographs are shown without titles, dates,
     locations or camera data. Flip any of these to true to bring that line
     back; the data is always there, refreshed from the files on every run of
     tools/build.py, so nothing needs regenerating first.

       title     the photograph's name
       location  where it was taken
       date      when it was taken
       exif      camera, lens, focal length, aperture, shutter, ISO
       caption   the bird's name, under the camera line, where photos.json
                 gives a photograph one ("caption"), with its scientific
                 name ("sci") and a link to its eBird page ("ebird")

     `grid` controls the caption that slides up over a thumbnail on hover;
     `lightbox` controls the block under the enlarged photograph. A field
     shows only if it is true in both its own row and the surface's row.
     ------------------------------------------------------------------ */
  var CAPTIONS = {
    grid:     { title: false, location: false },
    lightbox: { title: false, location: false, date: false, exif: true, caption: true }
  };

  // Which EXIF fields print, and in what order. Any field that's missing from
  // a given photograph is skipped, so drone frames (which report no lens
  // worth naming) simply show fewer items.
  var EXIF_FIELDS = ["camera", "lens", "focal", "aperture", "shutter", "iso"];

  /* ------------------------------------------------------------------
     NAV_MENUS — a short drop-down under a nav tab, keyed by the page that
     tab opens. Pointing at the tab (or tabbing onto it) shows the menu, on a
     laptop with a mouse; phones and touch screens just follow the tab to
     its page. Each entry goes straight where its href says, so eBird
     Explorer opens the app itself, not the Projects page.
     ------------------------------------------------------------------ */
  var NAV_MENUS = {
    "projects.html": [
      { label: "eBird Explorer", href: "https://ebird-explorer.onrender.com" },
      { label: "Photography Planner", href: "shoot-planner/" },
      { label: "Retreat Finder", href: "retreat-finder/" },
      { label: "Site Ranking", href: "https://ebird-explorer.onrender.com/site-ranking" }
    ]
  };

  /* ------------------------------------------------------------------
     中 / EN — the site in Simplified Chinese (Newton, 2026-10-17). The
     switch at the far right of the nav saves the choice (localStorage
     "lang") and reloads; a line in every page's <head> sets
     <html data-site-lang="zh"> before the first paint, and everything below
     reads it through NLSite.lang(). <html lang> stays "en": only the texts
     that turn Chinese are marked (chineseText, below), so his English
     titles, the Latin names and the instruments keep their own type.
     ?edit is always English, so no Chinese is ever saved into text.json.

     Only the words around the work are translated. His essays, blurbs,
     notes and the Contact page's words stay as he wrote them, and so do
     his own titles (Catalina in Film, Grouse Country, The Snowy West…): a
     title missing from ZH_PLACES.titles simply stays English.

     ZH_UI     the interface, keyed by the English as it is written, with
               {placeholders}. A label he rewrites in English drops back to
               English until it has a line here.
     ZH_EDIT   [data-edit] slots translated by their key: the Projects page
               (his blurbs in Chinese, given 2026-10-17) and the landing's
               taglines. A blurb he rewrites in English needs its Chinese
               rewritten here too.
     ZH_PLACES collection titles, list regions, the card's "where" parts,
               and the pins that go Chinese: every pin in China, and
               elsewhere the cities only (parks, reserves, islands, rivers
               and roads stay English). A new place is one line in the
               right group. Pins, titles and where-parts are kept apart
               because the same name can be both (Hawai'i Island is a pin,
               and stays English there, and a where-part, which doesn't).
     Bird names are in data/photos.json ("zh", beside caption, sci and
     ebird), from eBird's zh_SIM taxonomy.
     ------------------------------------------------------------------ */
  var ZH_UI = {
    // the bar, the footer, the page titles
    "Primary": "主导航", "Work": "作品", "About": "关于", "Projects": "项目", "Contact": "联系",
    // "Newton Liu Photography" stays English in both (Newton, 2026-10-17)
    "Skip to collections": "跳到作品集", "Skip to photographs": "跳到照片",
    "Newton Liu. All photographs are my own.": "Newton Liu。所有照片均为本人拍摄。",
    "White background": "白色背景", "Black background": "黑色背景",
    "Newton Liu — Bird, Wildlife & Landscape Photography": "Newton Liu — 鸟类、野生动物与风光摄影",
    "{title} — Newton Liu Photography": "{title} — Newton Liu Photography",
    "Contact — Newton Liu Photography": "联系方式 — Newton Liu Photography",
    // the Index, the galleries, the lightbox
    "Collections": "作品集", "Globe": "地球仪", "Index": "目录", "Loading…": "加载中…",
    "More about the work →": "了解更多 →",
    "← All collections": "← 全部作品集", "Loading photographs…": "正在加载照片…",
    "Photographs from this trip haven't been added yet.": "这次旅行的照片尚未添加。",
    "No collections defined yet.": "还没有作品集。",
    "Couldn't load the site data. {err}": "无法加载网站数据。{err}",
    "Photograph viewer": "照片查看器", "Close viewer": "关闭查看器",
    "Previous photograph": "上一张照片", "Next photograph": "下一张照片",
    "View photograph {n} of {total} larger": "放大查看第{n}张照片（共{total}张）",
    "View {title} larger": "放大查看：{title}",
    "Photograph from {collection}": "{collection}的照片", "Photograph": "照片",
    "photographed at {location}": "摄于{location}",
    // Projects (the names stay English)
    "Open the app →": "打开应用 →",
    // the globe (globe.js LABELS)
    "Tour": "导览", "Back to overview": "返回总览", "Overview": "总览",
    "View collection": "查看作品集", "With writing": "附有文字", ", with writing": "，附有文字",
    "Load globe": "加载地球仪", "Globe unavailable. The collections are listed here.": "地球仪无法显示。作品集都在列表里。",
    "Couldn't load the collections.": "作品集加载失败。",
    "Showing {title}.": "正在显示{title}。", "Select again to open the collection.": "再次选择即可打开作品集。",
    "Tour started.": "导览已开始。", "Tour ended.": "导览已结束。",
    "Globe unavailable": "地球仪无法显示", "Globe not loaded": "地球仪未加载", "Tour · ": "导览 · ",
    "Use two fingers to turn the globe": "用双指转动地球仪",
    "Use Ctrl + scroll to zoom the map": "按住 Ctrl 并滚动以缩放地图",
    "Use ⌘ + scroll to zoom the map": "按住 ⌘ 并滚动以缩放地图",
    // the travel journal (journals/<place>/, assets/journal.js); his entries
    // themselves are never translated
    "Journal": "游记", "Journal →": "游记 →", "Skip to the journal": "跳到游记",
    "This journal isn't published yet.": "这篇游记尚未发布。", "See the collections →": "查看作品集 →",
    "Couldn't load the journal. {err}": "游记加载失败。{err}",
    "Entries": "篇目", "No. {n}": "第{n}篇", "Route map": "路线图", "Map unavailable": "地图无法显示",
    "Hide map": "隐藏地图", "Show map": "显示地图", "Not on the map": "不在地图上",
    "Pause video": "暂停视频", "Play video": "播放视频", "Video": "视频",
    "Date to come": "日期待定", "Dates to come": "日期待定",
    "Placeholder": "占位", "Cover": "封面", "Photo": "照片", "Text": "文字",
    "Shown in the local preview only": "仅在本地预览中显示",
    "A photograph or a short video to come": "照片或短视频待补",
    "Couldn't load {file}": "无法加载 {file}",
    // its route map (assets/journal-map.js LABELS)
    "Zoom in": "放大", "Zoom out": "缩小",
    "{place}: {title}": "{place}：{title}", "{place}: {n} entries": "{place}：{n}篇",
    "Entries at {place}": "{place}的游记"
  };

  var ZH_EDIT = {
    "home.heroTitle": "鸟类、野生动物，以及它们栖息的地方。",
    "home.heroSub": "从加拉帕戈斯群岛到东喜马拉雅的野外摄影。",
    "contact.title": "联系方式",
    "projects.title": "项目",
    "projects.ebird.kicker": "网页应用 · 2026", "projects.shootplanner.kicker": "网页应用 · 2026",
    "projects.retreatfinder.kicker": "网页应用 · 2026", "projects.siteranking.kicker": "网页应用 · 2026",
    "projects.ebird.status": "建设中", "projects.shootplanner.status": "建设中",
    "projects.retreatfinder.status": "建设中", "projects.siteranking.status": "建设中",
    "projects.ebird.note": "需要密码", "projects.shootplanner.note": "需要密码",
    "projects.retreatfinder.note": "需要密码", "projects.siteranking.note": "需要密码",
    "projects.ebird.blurb": "一个基于 eBird 实时数据的观鸟行程规划工具。用户选定一个区域并输入目标鸟种，引擎会搜索它们最近在哪里被报告过、哪些热点能找到最多的目标鸟种，并为观鸟者生成一份切实可行的计划。",
    "projects.ebird.shot1": "区域计划：区域内的所有热点，按能找到的目标鸟种数量排序",
    "projects.ebird.shot2": "鸟种矩阵：每种鸟在每个区域的情况，以它在完整清单中所占的比例衡量",
    "projects.shootplanner.blurb": "一个风光摄影规划工具。选定日期和落脚点，它会结合天气预报、潮汐和空间天气数据，针对一天中的不同时段和不同元素（日出、日落、金色光线、柔光、雾、星空和极光）搜索拍摄点并打分。然后它会安排好一整天：几点起床、开车去哪里、每个时段的备选方案，以及每个分数背后的理由。它始于2026年10月在魁北克夏洛瓦度过的一个风雨交加的星期。",
    "projects.shootplanner.shot1": "每日计划：几点起床，然后每个时段的首选和备选，并附上理由",
    "projects.shootplanner.shot2": "拍摄点详情：当天逐小时的各层云量、雾和雨，对照日月的升落",
    "projects.shootplanner.shot3": "地图：每个拍摄点都标出它当天的最高分",
    "projects.retreatfinder.blurb": "一个为旅途寻找住处的工具。Claude 会搜索 Airbnb、VRBO、Booking.com 以及房东自己的网站，并逐一阅读每个房源。应用会根据一套精心整理的偏好为每个住处打分：景观、设计、工作空间、清静程度等。它会展示每项判断背后的依据，记住每一个被否决的住处及其原因，并追踪具体日期的价格。",
    "projects.siteranking.blurb": "受热门美食排名应用 Beli 启发，这是一个为用户去过的 eBird 观鸟热点打造的个人排名系统。每次到访都会按鸟的质量、鸟种数量和体验打分；然后通过两两比较，把每个地点在所属档次内排出先后，让这份榜单说明哪些地方才是真正最好的。\n\n它与 eBird Explorer 一同运行，共用同一个登录。"
  };

  var ZH_PLACES = {
    titles: {
      "Alaska": "阿拉斯加", "California": "加利福尼亚", "Florida": "佛罗里达", "Hawai'i": "夏威夷",
      "New England": "新英格兰", "Quebec": "魁北克", "Ecuador": "厄瓜多尔", "Galápagos": "加拉帕戈斯群岛",
      "Peru": "秘鲁", "Guangxi & Guangdong": "广西 & 广东", "Malaysia": "马来西亚", "Sri Lanka": "斯里兰卡",
      "Yunnan": "云南", "Yellowstone & North Dakota": "黄石 & 北达科他", "Morocco": "摩洛哥",
      "Guangxi": "广西", "Arizona": "亚利桑那", "Big Bend": "大弯曲"
    },
    regions: { "North America": "北美洲", "South America": "南美洲", "Asia": "亚洲", "Africa": "非洲" },
    // A whole line first ("Sabah, Borneo" reads the other way round in
    // Chinese), else each part between the dots.
    where: {
      "Sabah, Borneo": "婆罗洲沙巴",
      "Maine": "缅因", "Massachusetts": "马萨诸塞", "New Jersey": "新泽西", "Texas": "得克萨斯",
      "Hawai'i Island": "夏威夷岛", "Kaua'i": "考爱岛", "Maui": "毛伊岛", "O'ahu": "瓦胡岛",
      "Colorado": "科罗拉多", "Idaho": "爱达荷", "Montana": "蒙大拿", "Oregon": "俄勒冈",
      "Washington": "华盛顿州", "North Dakota": "北达科他", "Wyoming": "怀俄明", "New Mexico": "新墨西哥",
      "Utah": "犹他", "Alberta": "艾伯塔", "British Columbia": "不列颠哥伦比亚", "Yukon": "育空",
      "China": "中国", "Nebraska": "内布拉斯加", "Nuevo León": "新莱昂"
    },
    pins: {
      // cities
      "Monterey": "蒙特雷", "Monterrey": "蒙特雷",
      "Vancouver": "温哥华", "Lima": "利马", "Cusco": "库斯科", "Matara": "马塔拉", "Nuwara Eliya": "努沃勒埃利耶",
      "Kandy": "康提", "Sedona": "塞多纳", "Phoenix": "凤凰城", "Juneau": "朱诺", "Utqiagvik": "乌特恰维克",
      "Fairbanks": "费尔班克斯", "Rabat": "拉巴特", "Agadir": "阿加迪尔", "Guelmim": "盖勒敏",
      "Montreal": "蒙特利尔", "Quebec City": "魁北克市",
      "Ottawa/Gatineau": "渥太华/加蒂诺", "Craig": "克雷格",
      // the national parks in the US and Canada (Newton, 2026-10-17); not
      // Quebec's own parcs nationaux, which keep their French names
      "Acadia National Park": "阿卡迪亚国家公园", "Arches National Park": "拱门国家公园",
      "Banff National Park": "班夫国家公园", "Big Bend National Park": "大弯曲国家公园",
      "Black Canyon of the Gunnison National Park": "甘尼森黑峡谷国家公园",
      "Channel Islands National Park": "海峡群岛国家公园", "Crater Lake National Park": "火山口湖国家公园",
      "Denali National Park": "德纳里国家公园", "Everglades National Park": "大沼泽地国家公园",
      "Glacier Bay National Park": "冰川湾国家公园", "Glacier National Park": "冰川国家公园",
      "Grand Teton National Park": "大提顿国家公园", "Great Sand Dunes National Park": "大沙丘国家公园",
      "Jasper National Park": "贾斯珀国家公园", "Katmai National Park": "卡特迈国家公园",
      "Kenai Fjords National Park": "基奈峡湾国家公园", "Kluane National Park": "克卢恩国家公园",
      "Parc national de la Mauricie": "莫里西国家公园", "Mesa Verde National Park": "弗德台地国家公园",
      "Mount Rainier National Park": "雷尼尔山国家公园", "Saguaro National Park": "巨人柱国家公园",
      "Sequoia & Kings Canyon National Parks": "红杉 & 国王峡谷国家公园",
      "Theodore Roosevelt National Park": "西奥多·罗斯福国家公园",
      "Waterton Lakes National Park": "沃特顿湖国家公园", "Yellowstone National Park": "黄石国家公园",
      "Yosemite National Park": "优胜美地国家公园",
      // and Sri Lanka's, Morocco's and Mexico's
      "Yala National Park": "雅拉国家公园", "Bundala National Park": "本达拉国家公园",
      "Horton Plains National Park": "霍顿平原国家公园", "Souss-Massa National Park": "苏斯-马萨国家公园",
      "Cumbres de Monterrey National Park": "蒙特雷山国家公园",
      // everything in China
      "Shenzhen Bay": "深圳湾", "Nonggang National Nature Reserve": "弄岗国家级自然保护区",
      "Gaoligong Mountains": "高黎贡山", "Dali": "大理", "Lijiang": "丽江", "Shangri-La": "香格里拉"
    }
  };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December"];

  var body = document.body;
  var BASE = body.dataset.base || "";
  var PAGE = body.dataset.page || "";

  /* ---------- small helpers ------------------------------------------ */

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function getJSON(path) {
    return fetch(BASE + path, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error(path + ": HTTP " + res.status);
      return res.json();
    });
  }

  // The photographs live in Cloudflare R2, not in this repo (CLAUDE.md,
  // "Where the photographs live"); the object keys are the repo paths, so
  // "images/peru/EZLE2124.jpg" is R2 + that. The local preview (tools/serve.py,
  // which only listens on 127.0.0.1) reads them from images/ on disk instead,
  // so a collection can be arranged before a single file is uploaded. To check
  // an upload, preview against R2 by running  localStorage.media = "r2"  in the
  // console, and delete it afterwards.
  var R2 = "https://pub-ce9a4b2d164449d8ac95ccbca47549a3.r2.dev/";
  var MEDIA = (function () {
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var force = null;
    try { force = localStorage.getItem("media"); } catch (e) {}
    return local && force !== "r2" ? BASE : R2;
  })();

  // Photo paths in the manifest are root-relative. Each segment is encoded:
  // a space in a filename would otherwise split a srcset entry in two, and an
  // apostrophe (Swainson's Hawk) would end the hero's CSS url('...') early.
  // encodeURIComponent leaves ! ' ( ) * alone, so those are done by hand; the
  // result matches url_for() in tools/upload.py.
  function encodeSegment(seg) {
    return encodeURIComponent(seg).replace(/[!'()*]/g, function (c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }
  function url(src) {
    return MEDIA + src.split("/").map(encodeSegment).join("/");
  }

  // ---- Responsive images -------------------------------------------------
  // build.py writes a ladder of widths for every photograph. A `srcset` lets
  // the browser choose one, but only if `sizes` tells it how wide the slot
  // will be: with no `sizes` it assumes the full viewport and fetches the
  // largest file every time, on a phone as readily as on a 5K display. The
  // originals are 4000px, so getting this wrong is a 2 MB mistake per
  // photograph. Every caller below therefore states its own width.

  function srcsetOf(photo) {
    if (!photo.variants || photo.variants.length < 2) return "";
    return photo.variants.map(function (v) {
      return url(v.src) + " " + v.w + "w";
    }).join(", ");
  }

  // Order matters and is easy to get wrong, so it lives here rather than at
  // the call sites: assigning `src` first starts a fetch immediately and the
  // browser keeps that file, silently ignoring the srcset added afterwards.
  // `sizes` before `srcset` before `src`, always. This function is the only
  // place a photograph's src is assigned.
  function responsive(img, photo, sizes, fallback) {
    var set = srcsetOf(photo);
    if (set) {
      img.sizes = sizes;
      img.srcset = set;
    }
    img.src = url(fallback || photo.src);
    return img;
  }

  // A tile's width as a share of the packed grid — which is the whole page
  // below 1000px and the 62% right-hand column above it (.book-body in the
  // CSS), capped once --wrap-wide stops growing at 108rem.
  // `phone` is the share below 620px, for a row that folds there (PLLL).
  function tileSizes(share, phone) {
    return (phone ? "(max-width: 620px) " + Math.round(phone * 100) + "vw, " : "") +
           "(max-width: 1000px) " + Math.round(share * 100) + "vw, " +
           "(min-width: 1800px) " + Math.round(share * 1042) + "px, " +
           Math.round(share * 62) + "vw";
  }

  // Height-capped slots (the opener, the lightbox) are limited by the window's
  // height, not its width, so their width follows from the photograph's ratio.
  function cappedSizes(photo, vh) {
    return "min(100vw, " + Math.round(vh * aspectOf(photo)) + "vh)";
  }

  function pickForWidth(photo, cssWidth) {
    var want = cssWidth * (window.devicePixelRatio || 1);
    if (!photo.variants || !photo.variants.length) return photo.src;
    var best = photo.variants[photo.variants.length - 1];
    for (var i = 0; i < photo.variants.length; i++) {
      if (photo.variants[i].w >= want) { best = photo.variants[i]; break; }
    }
    return best.src;
  }

  function formatDate(value) {
    if (!value) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return value;                       // freeform dates pass through
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return value;
    if (lang() === "zh") return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  }

  // The date printed under a gallery's heading — one line for the whole
  // collection rather than a date on every photograph. Derived from the
  // capture dates in the manifest, so it stays right as photographs are
  // added. Set "date" on the collection in data/collections.json to override.
  // Always in English, like the dates written in collections.json: a page
  // shows either kind through dateText() below, which turns both Chinese.
  function collectionDate(photos) {
    var dates = photos
      .map(function (p) { return p.date; })
      .filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); })
      .sort();
    if (!dates.length) return "";

    function parse(s) {
      var b = s.split("-");
      return new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
    }
    var first = parse(dates[0]);
    var last = parse(dates[dates.length - 1]);

    var monthYear = { month: "long", year: "numeric" };
    var full = function (d) { return d.toLocaleDateString("en-US", monthYear); };

    if (first.getFullYear() === last.getFullYear()) {
      if (first.getMonth() === last.getMonth()) return full(last);
      // Same year, different months: "October – December 2025"
      return first.toLocaleDateString("en-US", { month: "long" }) + " – " + full(last);
    }
    return full(first) + " – " + full(last);
  }

  function aspectOf(photo) {
    var w = Number(photo.width), h = Number(photo.height);
    if (!w || !h) return 1.5;
    // Clamp so nothing wrecks a row, but loosely enough that an xPan turned
    // upright (0.37) keeps its own shape rather than being cropped to fit.
    return Math.max(0.3, Math.min(4, w / h));
  }

  // Screen readers still need something, even when nothing is printed on
  // screen. Falls back to the collection, which is the only description
  // that exists when captions are off.
  var collectionName = "";

  function altFor(photo) {
    if (CAPTIONS.lightbox.title && photo.title) {
      return [photo.title, photo.location && tr("photographed at {location}", { location: photo.location })]
        .filter(Boolean).join(lang() === "zh" ? "，" : ", ");
    }
    return collectionName ? tr("Photograph from {collection}", { collection: placeName(collectionName) }) : tr("Photograph");
  }

  function status(container, message) {
    container.textContent = "";
    var p = el("p", "grid-status");
    p.textContent = message;
    container.appendChild(p);
  }

  /* ---------- 中 / EN: the language (ZH_UI, ZH_EDIT, ZH_PLACES) ---------- */

  var EDIT_MODE = /[?&]edit\b/.test(location.search);
  var HAN_ALL = /[㐀-鿿豈-﫿]/g;

  // "zh" or "en". The <head> line sets the attribute before the first
  // paint; a page without that line (an old preview) reads the stored
  // choice instead. ?edit is English whatever was chosen.
  var LANG = (function () {
    var root = document.documentElement;
    if (EDIT_MODE) { root.removeAttribute("data-site-lang"); return "en"; }
    if (root.getAttribute("data-site-lang") === "zh") return "zh";
    try {
      if (localStorage.getItem("lang") === "zh") { root.setAttribute("data-site-lang", "zh"); return "zh"; }
    } catch (e) {}
    return "en";
  })();
  function lang() { return LANG; }

  function fill(s, vars) {
    return !vars ? s : s.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
  }
  function own(map, key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; }

  // The interface's words: the Chinese when there is one, else the English.
  function tr(english, vars) {
    var zh = LANG === "zh" ? own(ZH_UI, english) : null;
    return fill(zh || english, vars);
  }
  // A [data-edit] slot's text: by its key (ZH_EDIT), then by its words.
  function slotText(key, english) {
    if (LANG !== "zh") return english;
    return own(ZH_EDIT, key) || own(ZH_UI, String(english).replace(/\s+/g, " ").trim()) || english;
  }
  function zhPlace(english) {
    return own(ZH_PLACES.titles, english) || own(ZH_PLACES.pins, english) || own(ZH_PLACES.where, english) || english;
  }
  function inLang(map) {
    return function (english) { return LANG === "zh" && english ? own(map, english) || english : english; };
  }
  var placeName = inLang(ZH_PLACES.titles), regionName = inLang(ZH_PLACES.regions), pinName = inLang(ZH_PLACES.pins);
  // "Maine · Massachusetts · New Jersey", part by part, the dots kept.
  function whereLine(line) {
    if (LANG !== "zh" || !line) return line;
    return own(ZH_PLACES.where, line) || line.split(" · ").map(function (part) {
      return own(ZH_PLACES.where, part) || part;
    }).join(" · ");
  }

  // The dates as collections.json and places.json write them, in Chinese:
  // "October 2026" 2026年10月, "February – March 2023" 2023年2–3月,
  // "December 2023 – January 2024" 2023年12月–2024年1月, a list joined with
  // 、. A date that reads any other way stays as written.
  function dateText(s) {
    if (LANG !== "zh" || !s) return s;
    var MY = "(" + MONTHS.join("|") + ")(?: (\\d{4}))?";
    var one = new RegExp("^" + MY + "(?: – " + MY + ")?$");
    var out = [], ok = true;
    s.split(/\s*,\s*|\s+\/\s+/).forEach(function (item) {
      // [_, month, year?, month to?, its year?]
      var m = one.exec(item.trim());
      if (!m || (m[3] ? !m[4] : !m[2])) { ok = false; return; }
      var m1 = MONTHS.indexOf(m[1]) + 1;
      if (!m[3]) { out.push(m[2] + "年" + m1 + "月"); return; }
      var m2 = MONTHS.indexOf(m[3]) + 1, y2 = m[4], y1 = m[2] || y2;
      out.push(y1 === y2 ? y1 + "年" + m1 + "–" + m2 + "月" : y1 + "年" + m1 + "月–" + y2 + "年" + m2 + "月");
    });
    return ok && out.length ? out.join("、") : s;
  }

  // Writes a text and marks it Chinese, or unmarks it, at once: code that
  // measures what it has just written (the globe's plate and readout)
  // can't wait for chineseText's observer, a moment later. The marks are
  // chineseText's own (lang plus data-zh), so it can undo them as usual.
  function mostlyHan(s) {
    return (s.match(HAN_ALL) || []).length > (s.match(/[A-Za-z]/g) || []).length;
  }
  function setText(node, s) {
    node.textContent = s == null ? "" : s;
    var zh = mostlyHan(node.textContent);
    if (zh && (!node.hasAttribute("lang") || node.hasAttribute("data-zh"))) {
      node.lang = "zh-Hans";
      node.setAttribute("data-zh", "");
    } else if (!zh && node.hasAttribute("data-zh")) {
      node.removeAttribute("lang");
      node.removeAttribute("data-zh");
    }
    return node;
  }

  // Saves the choice and reloads: every page draws itself in the language
  // it opens in, so nothing has to be redrawn in place. Storage blocked
  // (some private windows): the switch can't hold, so it does nothing.
  function setLang(l) {
    try { localStorage.setItem("lang", l === "zh" ? "zh" : "en"); } catch (e) { return; }
    location.reload();
  }

  // Shared with assets/globe.js so the landing resolves photograph URLs and
  // picks image sizes exactly as the galleries do (and follows the R2 switch),
  // and speaks the same language.
  window.NLSite = { url: url, responsive: responsive, collectionDate: collectionDate,
                    aspectOf: aspectOf, getJSON: getJSON,
                    lang: lang, t: tr, slot: slotText, place: placeName, zhPlace: zhPlace, region: regionName,
                    pin: pinName, where: whereLine, date: dateText, text: setText, setLang: setLang,
                    viewer: viewer };

  // The page's own words in Chinese, before the first paint (this script
  // runs at the end of <body>, ahead of any paint on a normal load): the
  // bar, the footer, the skip link, the gallery's back link and heading,
  // the status lines, aria labels and the tab's title. A text node is
  // translated where ZH_UI has it, so a link's arrow or the footer's year
  // stays as it is; a [data-edit] slot goes by its key (edit.js asks the
  // same of NLSite when text.json arrives). Never the prose, never ?edit.
  // Until it has run, site.css keeps these hidden in Chinese, so English
  // can't flash (data-i18n-ready).
  (function chrome() {
    var root = document.documentElement;
    if (LANG !== "zh") return;
    var SCOPE = ".skip-link, .masthead, .footer, .back-link, .grid-status, .view-switch, .g-list-head," +
                " .g-list-status, .g-fallback, .project-actions, .about-jump:not([data-lang])";
    Array.prototype.forEach.call(document.querySelectorAll(SCOPE), function (box) {
      var walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), n, todo = [];
      while ((n = walk.nextNode())) todo.push(n);
      todo.forEach(function (n) {
        if (n.parentElement && n.parentElement.closest("[data-edit]")) return;
        var key = n.data.replace(/\s+/g, " ").trim(), zh = key && own(ZH_UI, key);
        if (zh) n.data = n.data.match(/^\s*/)[0] + zh + n.data.match(/\s*$/)[0];
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[aria-label], [title]"), function (n) {
      ["aria-label", "title"].forEach(function (a) {
        var v = n.getAttribute(a), zh = v && own(ZH_UI, v);
        if (zh) n.setAttribute(a, zh);
      });
    });
    // The one-line slots (titles, taglines, Projects' words); edit.js lays
    // text.json over them later and translates the same way.
    Array.prototype.forEach.call(document.querySelectorAll("[data-edit]:not([data-edit-rich])"), function (n) {
      var english = n.hasAttribute("data-edit-lines")
        ? n.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t]+/g, " ").trim()
        : n.textContent;
      var zh = slotText(n.getAttribute("data-edit"), english);
      if (zh !== english) n.textContent = zh;
    });
    // A collection page's heading, before collections.json arrives.
    var h = document.querySelector(".gallery-title");
    if (h) h.textContent = placeName(h.textContent.trim());
    var m = /^(.*) — Newton Liu Photography$/.exec(document.title);
    document.title = own(ZH_UI, document.title) ||
      (m ? tr("{title} — Newton Liu Photography", { title: placeName(own(ZH_UI, m[1]) || m[1]) }) : document.title);
    root.setAttribute("data-i18n-ready", "");
  })();

  // Contact's list labels ("Email:") sit inside its prose slot, which edit.js
  // rewrites from text.json after load, so they are put into Chinese again
  // whenever that slot changes. Only the label before each link: the
  // sentence above it and the handles stay as written.
  (function contactLabels() {
    if (LANG !== "zh") return;
    var slot = document.querySelector('[data-edit="contact.prose"]');
    if (!slot) return;
    var ZH = { "Email:": "邮箱：", "Instagram:": "Instagram：", "Threads:": "Threads：",
               "eBird:": "eBird：", "XHS:": "XHS：" };
    function run() {
      Array.prototype.forEach.call(slot.querySelectorAll(".contact-list li"), function (li) {
        var n = li.firstChild, key = n && n.nodeType === 3 && n.data.trim();
        if (key && own(ZH, key)) n.data = ZH[key];
      });
    }
    run();
    new MutationObserver(run).observe(slot, { childList: true });
  })();

  Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (n) {
    n.textContent = String(new Date().getFullYear());
  });

  /* ---------- nav drop-downs (NAV_MENUS) -------------------------------- */

  // The tab is wrapped in a .nav-drop with its menu beside it, so CSS can
  // show the menu while the pointer or focus is anywhere inside the pair.
  // An off-site entry gets a small ↗ so it's clear it leaves the site.
  (function navMenus() {
    var links = document.querySelectorAll(".nav > a");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var page = (a.getAttribute("href") || "").split(/[?#]/)[0].split("/").pop();
      if (!page || !Object.prototype.hasOwnProperty.call(NAV_MENUS, page)) continue;
      var items = NAV_MENUS[page];
      if (!items || !items.length) continue;
      var wrap = el("span", "nav-drop");
      a.parentNode.insertBefore(wrap, a);
      wrap.appendChild(a);
      shutOnEscape(wrap);
      var menu = el("span", "nav-menu");
      var list = el("ul", "nav-menu-list");
      list.setAttribute("aria-label", a.textContent);
      items.forEach(function (item) {
        var li = el("li");
        var link = el("a");
        var offSite = /^https?:/.test(item.href);
        // An on-site href is written from the site's root ("shoot-planner/"),
        // so it is read from this page's base, as getJSON does.
        link.href = offSite || item.href.charAt(0) === "/" ? item.href : BASE + item.href;
        link.textContent = item.label;
        if (offSite) {
          var out = el("span", "nav-menu-out");
          out.setAttribute("aria-hidden", "true");
          out.textContent = "↗";
          link.appendChild(out);
        }
        li.appendChild(link);
        list.appendChild(li);
      });
      menu.appendChild(list);
      wrap.appendChild(menu);
    }

    // Esc shuts an open menu; it opens again once the pointer and focus have
    // both left and come back. Focus on a menu link goes back to its tab
    // first, as the browser would otherwise drop it when the link is hidden.
    function shutOnEscape(wrap) {
      var tab = wrap.firstChild;
      wrap.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" && e.key !== "Esc") return;
        wrap.classList.add("is-shut");
        if (document.activeElement !== tab && wrap.contains(document.activeElement)) tab.focus();
      });
      wrap.addEventListener("mouseleave", function () {
        if (!wrap.contains(document.activeElement)) wrap.classList.remove("is-shut");
      });
      wrap.addEventListener("focusout", function (e) {
        if (!e.relatedTarget || !wrap.contains(e.relatedTarget)) wrap.classList.remove("is-shut");
      });
    }
  })();

  /* ---------- black / white ground ------------------------------------- */

  // The <head> of every page applies a saved "white" before the first paint;
  // this adds the switch to the nav and remembers the visitor's choice.
  // Black (#121212) is the default, and anything else stored lands in Black,
  // including the old switch's "dark" (gray) and "light" (its white, which
  // is why White is saved under a new word). Storage can be blocked (private
  // windows), so every read and write is guarded and the switch still works
  // for the visit. The window colour is left to that head script until the
  // switch is used (the landing keeps its own), and every change is announced
  // as "nl:theme" so the landing can repaint its map.
  (function themeToggle() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var root = document.documentElement;
    var meta = document.querySelector('meta[name="theme-color"]');
    var btn = el("button", "theme-toggle");
    btn.type = "button";
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M8 1.5a6.5 6.5 0 0 0 0 13z" fill="currentColor"/></svg>';
    // One fixed name; aria-pressed says whether White is on.
    btn.setAttribute("aria-label", tr("White background"));
    function sync() {
      var light = root.dataset.theme === "light";
      btn.setAttribute("aria-pressed", light ? "true" : "false");
      btn.title = light ? tr("Black background") : tr("White background");
    }
    function set(light) {
      if (light) root.dataset.theme = "light"; else delete root.dataset.theme;
      sync();
      if (meta) meta.content = light ? "#ffffff" : "#121212";
      document.dispatchEvent(new CustomEvent("nl:theme", { detail: { light: light } }));
    }
    btn.addEventListener("click", function () {
      var light = root.dataset.theme !== "light";
      try { localStorage.setItem("theme", light ? "white" : "black"); } catch (e) {}
      set(light);
    });
    // A page brought back by the Back button is the one that was left, in
    // the ground it was left in: catch it up with a switch made since.
    window.addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      var light;
      try { light = localStorage.getItem("theme") === "white"; } catch (err) { return; }
      if (light !== (root.dataset.theme === "light")) set(light);
    });
    sync();

    // 中 / EN, after it at the far right (Newton, 2026-10-17): it names the
    // language it switches to, "中" in English and "EN" in Chinese, under
    // one fixed name. Not in ?edit, which is always English. A page
    // brought back by the Back button in the other language reloads.
    var langBtn = null;
    if (!EDIT_MODE) {
      langBtn = el("button", "lang-toggle");
      langBtn.type = "button";
      langBtn.setAttribute("aria-label", "中文 / English");
      if (LANG === "zh") { langBtn.textContent = "EN"; langBtn.lang = "en"; langBtn.title = "English"; }
      else { langBtn.textContent = "中"; langBtn.lang = "zh-Hans"; langBtn.title = "中文"; }
      langBtn.addEventListener("click", function () { setLang(LANG === "zh" ? "en" : "zh"); });
      window.addEventListener("pageshow", function (e) {
        if (!e.persisted) return;
        var saved;
        try { saved = localStorage.getItem("lang") === "zh" ? "zh" : "en"; } catch (err) { return; }
        if (saved !== LANG) location.reload();
      });
    }

    // At the end of the nav; on a phone the nav is a row that scrolls
    // sideways and could carry the switches out of sight, so there they move
    // up to the right of the wordmark instead (site.css, the 620px block).
    // Both are appended each time, so 中 / EN always stays last.
    var phone = window.matchMedia ? window.matchMedia("(max-width: 620px)") : null;
    function place() {
      var to = phone && phone.matches ? nav.parentNode : nav;
      to.appendChild(btn);
      if (langBtn) to.appendChild(langBtn);
    }
    place();
    if (phone && phone.addEventListener) phone.addEventListener("change", place);
    else if (phone && phone.addListener) phone.addListener(place);
  })();

  // The phone nav fades at its right edge only while there is more of it to
  // scroll to (.has-more, site.css), so a row that fits is never dimmed.
  (function navOverflow() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    function more() {
      var on = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
      if (on !== nav.classList.contains("has-more")) nav.classList.toggle("has-more", on);
    }
    nav.addEventListener("scroll", more, { passive: true });
    window.addEventListener("resize", more);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(more);
    more();
  })();

  // A rail of jump links lights the part being read (aria-current, styled
  // in site.css): Projects its projects, and a prose page whose rail says
  // data-follow its headings (About; Newton asked, 2026-10-15). That is the last part
  // whose top has passed 40% of the way down the window, the first until
  // then, and the last once the page can scroll no further, since a short
  // last part never reaches the line. A rail link just followed (or the
  // page's own #hash) stays lit while the smooth scroll runs and after it
  // lands, even at the foot of the page, until the reader scrolls on their
  // own. The links and parts are looked up each time: edit.js rewrites an
  // About page's prose and rebuilds its rail when data/text.json arrives.
  function railLights(nav, partsOf) {
    if (!nav || nav.hasAttribute("data-rail")) return;   // each rail is wired once
    nav.setAttribute("data-rail", "");
    var pinned = null, queued = false;
    function link(id) {
      return Array.prototype.filter.call(nav.querySelectorAll('a[href^="#"]'), function (a) {
        return a.getAttribute("href") === "#" + id;
      })[0] || null;
    }
    function light(id) {
      Array.prototype.forEach.call(nav.querySelectorAll('a[href^="#"]'), function (a) {
        if (a.getAttribute("href") === "#" + id) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      });
    }
    function update() {
      queued = false;
      var parts = partsOf();
      if (pinned && link(pinned)) return light(pinned);
      if (!parts.length) return;
      var line = window.innerHeight * 0.4, pick = parts[0];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].getBoundingClientRect().top <= line) pick = parts[i];
      }
      var doc = document.documentElement;
      if (window.innerHeight + window.pageYOffset >= doc.scrollHeight - 2) pick = parts[parts.length - 1];
      light(pick.id);
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
    function unpin() { if (pinned) { pinned = null; queue(); } }
    nav.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (a) { pinned = a.getAttribute("href").slice(1); queue(); }
    });
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (type === "mousedown" && nav.contains(e.target)) return;   // the click above pins instead
        unpin();
      }, { passive: true });
    });
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    window.addEventListener("nl:lang", queue);                         // About switched language
    if (window.MutationObserver) new MutationObserver(queue).observe(nav, { childList: true });
    if (location.hash) pinned = location.hash.slice(1);
    update();
  }
  railLights(document.querySelector(".projects-jump"), function () {
    return document.querySelectorAll(".projects > .project[id]");
  });
  Array.prototype.forEach.call(document.querySelectorAll(".about-jump[data-jump-from][data-follow]"), function (nav) {
    railLights(nav, function () {
      var source = document.querySelector(nav.getAttribute("data-jump-from"));
      return source ? source.querySelectorAll("h2[id], h3[id]") : [];
    });
  });

  // About in Chinese or English: each version is everything marked
  // data-lang, and site.css shows one (html[data-about-lang="en"]) and hides
  // the other. The site's 中 / EN switch picks it (Newton, 2026-10-17; the
  // rail's own 中文 / English buttons went), but only once there is an
  // English story to read: until #my-story-en is followed by more than the
  // next heading, About stays Chinese in both, as it always opened. A link
  // to a part of the other version (about.html#gear-en) opens that one, for
  // that visit only. The English page is watched, since edit.js rewrites it
  // from text.json after the first paint; "nl:lang" tells the rail and the
  // figures whenever the version changes.
  (function aboutLanguage() {
    if (!document.querySelector(".about-prose[data-lang]")) return;
    try { localStorage.removeItem("aboutLang"); } catch (e) {}   // the old buttons' choice
    var root = document.documentElement, byHash = null;
    function storyWritten() {
      var h = document.getElementById("my-story-en"), next = h && h.nextElementSibling;
      return !!next && next.tagName !== "H2";
    }
    function shown() { return root.getAttribute("data-about-lang") === "en" ? "en" : "zh"; }
    function apply(force) {
      var v = byHash || (LANG === "en" && storyWritten() ? "en" : "zh");
      if (v === shown() && !force) return;
      if (v === "en") root.setAttribute("data-about-lang", "en");
      else root.removeAttribute("data-about-lang");
      window.dispatchEvent(new Event("nl:lang"));
    }
    function hashed() {   // the version the URL's #part is in, if any
      var target = null;
      try { target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) {}
      var version = target && target.closest("[data-lang]");
      return version ? version.getAttribute("data-lang") : null;
    }
    byHash = hashed();
    apply(true);
    window.addEventListener("hashchange", function () {
      var v = hashed();
      if (!v || v === shown()) return;
      byHash = v;
      apply();
      document.getElementById(decodeURIComponent(location.hash.slice(1))).scrollIntoView();
    });
    var en = document.getElementById("about-en");
    if (en && window.MutationObserver) new MutationObserver(function () { apply(); }).observe(en, { childList: true });
  })();

  // My photography in numbers (About; Newton's pick, the "Readout" look,
  // 2026-10-16). Its heading is his, in the prose (#numbers, #numbers-en);
  // the charts are built here, right under it, and built again whenever
  // the prose is rewritten (edit.js lays data/text.json over it, and its
  // sanitiser would strip a chart's box out of the essay, so the box is
  // never part of the text). None in ?edit, or they would be saved into it.
  // Five blocks: all photos (one large numeral, by country, year and
  // month), the days in the field (by year and month), the trips (the biggest, with the top ten), the hours of the day
  // (with the busiest days), and the busiest clock hour (with the busiest
  // single hours), in the words of the version it is in. Every bar carries
  // a rough count under it (54k); pointing at, tapping or focusing a bar or
  // a row reads it exactly: the bar's own count turns exact, and a block's
  // numeral reads it too, then settles back. In a wide box each
  // block is two columns; the hours of the day then span both.
  (function photoNumbers() {
    var proses = document.querySelectorAll(".about-prose");
    if (!proses.length || /[?&]edit\b/.test(location.search)) return;

    // His counts, as he sent them (2026-10-16): photos by year, month and
    // country as of Oct 15, 2026; the rest from his hour, day and trip
    // charts. Dates and hours are kept as numbers and set in English or
    // Chinese below (T).
    var D = {
      asOf: "2026-10-15",
      total: 515443,
      years: [[2016, 10638], [2017, 18225], [2018, 2554], [2019, 0], [2020, 44], [2021, 5995], [2022, 15001],
        [2023, 128872], [2024, 119243], [2025, 119684], [2026, 93336]],
      // January to December, all years combined
      months: [26794, 51611, 36666, 24795, 49584, 27433, 29116, 71760, 1227, 43006, 77057, 74408],
      countries: [["United States", 190779], ["China", 64927], ["Ecuador", 44896], ["Puerto Rico", 39462],
        ["Sri Lanka", 38353], ["Colombia", 29096], ["Morocco", 26751], ["Malaysia", 21759], ["Canada", 15097],
        ["Peru", 11796], ["India", 10102], ["Nepal", 8069], ["Mexico", 4267], ["New Zealand", 2681],
        ["Taiwan", 1759], ["Singapore", 1093], ["Japan", 15]],
      // 0 to 23 (12 am to 11 pm)
      hours: [421, 361, 1003, 518, 1065, 3787, 22132, 54191, 50327, 48955, 51182, 51288, 32637, 27740, 20961,
        31070, 30591, 30917, 18705, 11306, 5791, 2506, 1374, 1016],
      // The ten biggest trips: where (his names, 2026-10-16), the month (and
      // the last month, if another), days (and which, in English and
      // Chinese; no longer shown), images a day, cameras (no longer shown),
      // images (each shutter press once).
      trips: [
        ["Galápagos & Ecuador", "2023-08", null, 14, ["Aug 3–16", "8月3–16日"], 3177, "R5 + R6 II", 44477],
        ["Sri Lanka", "2024-11", null, 10, null, 3804, "R5 II + R6 II", 38042],
        ["Yunnan", "2024-12", null, 8, null, 4419, "R5 II + R6 II", 35355],
        ["Florida", "2023-11", null, 9, null, 3435, "R5 + R6 II", 30918],
        ["Puerto Rico and US Virgin Islands", "2025-02", null, 10, null, 2913, "R5 II", 29132],
        ["Colombia", "2025-10", null, 4, null, 7274, "R5 II + R6 II", 29096],
        ["Texas & Nuevo León", "2026-05", null, 13, null, 2168, "R5 II", 28184],
        ["Morocco", "2026-03", null, 6, null, 4458, "R5 II", 26751],
        ["Canada & Alaska", "2026-05", "2026-06", 26, null, 686, "R5 II + X2D II", 17842],
        ["Arizona", "2025-01", null, 7, null, 2391, "R5 II", 16740]
      ],
      // Days in the field (2026-10-16): by year from 2016, by month all years
      // combined, and the longest run of days in a row (twice).
      field: {
        from: "2016-02", to: "2026-10",
        years: [35, 32, 11, 0, 2, 24, 60, 79, 58, 71, 74],
        months: [41, 25, 19, 30, 49, 50, 43, 38, 9, 26, 40, 76],
        run: { days: 14, when: ["2023-08", "2025-01"] }
      },
      mostPerDay: { n: 7274, where: "Colombia", when: "2025-10" },
      busiestHour: { hour: 7, n: 54191 },   // the hour of day, all days
      busiestDays: [
        ["2025-10-12", "Colombia", 10195],
        ["2023-11-25", "Florida", 9354],
        ["2024-12-05", "Yunnan", 8902],
        ["2024-12-06", "Yunnan", 8236],
        ["2025-10-13", "Colombia", 8174],
        ["2026-03-12", "Morocco", 7937],
        ["2024-11-12", "Sri Lanka", 7318],
        ["2023-08-15", "Mindo", 7311],
        ["2025-08-23", "Quebec", 6927],
        ["2025-10-11", "Colombia", 6740]
      ],
      // date, the hour it began, where, cameras (no longer shown), photos
      busiestHours: [
        ["2026-03-11", 17, "Morocco", "R5 II", 2838],
        ["2024-12-05", 9, "Yunnan", "R5 II", 2693],
        ["2025-10-11", 10, "Colombia", "R5 II", 2509],
        ["2024-12-05", 15, "Yunnan", "R5 II", 2506],
        ["2023-11-25", 16, "Florida", "R5 + R6 II", 2462],
        ["2024-12-05", 10, "Yunnan", "R5 II", 2401],
        ["2024-10-27", 11, "Guangxi", "R5 II + R6 II", 2393],
        ["2023-11-25", 17, "Florida", "R5 + R6 II", 2368],
        ["2025-10-12", 11, "Colombia", "R5 II", 2338],
        ["2024-12-04", 16, "Yunnan", "R5 II", 2333]
      ]
    };

    // The places in Chinese, for the Chinese page (Newton, 2026-10-17: every
    // place name in Chinese there; Mindo is 厄瓜多尔). English keeps D's.
    var ZH_PLACE = {
      "United States": "美国", "China": "中国", "Ecuador": "厄瓜多尔", "Puerto Rico": "波多黎各",
      "Sri Lanka": "斯里兰卡", "Colombia": "哥伦比亚", "Morocco": "摩洛哥", "Malaysia": "马来西亚",
      "Canada": "加拿大", "Peru": "秘鲁", "India": "印度", "Nepal": "尼泊尔", "Mexico": "墨西哥",
      "New Zealand": "新西兰", "Taiwan": "台湾", "Singapore": "新加坡", "Japan": "日本",
      "Galápagos & Ecuador": "加拉帕戈斯群岛 & 厄瓜多尔", "Yunnan": "云南", "Florida": "佛罗里达",
      "Puerto Rico and US Virgin Islands": "波多黎各 & 美属维尔京群岛",
      "Texas & Nuevo León": "得克萨斯 & 新莱昂", "Canada & Alaska": "加拿大 & 阿拉斯加",
      "Arizona": "亚利桑那", "Quebec": "魁北克", "Guangxi": "广西", "Mindo": "厄瓜多尔"
    };

    // Each version's words: the English page's in English, the Chinese
    // page's in Chinese (Newton, 2026-10-16; places keep their English
    // names). A bar's rough count is 54k in English, and in Chinese in
    // 万 (ten thousand), the unit named once in the chart's title.
    function ymd(iso) { var p = iso.split("-").map(Number); return { y: p[0], m: p[1] - 1, d: p[2] || 1 }; }
    var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
      "November", "December"];
    function ap(h) { return (h % 12 || 12) + (h % 24 < 12 ? "am" : "pm"); }
    var T = {
      en: {
        rough: function (n) { return !n ? "0" : n < 1000 ? "<1k" : Math.round(n / 1000) + "k"; },
        share: function (p) { return p + " of all photos"; },
        n: function (n) { return fmt(n) + " photos"; },
        images: function (n) { return fmt(n) + " images"; },
        photos: "photos", dayUnit: "days",       // the unit beside a big number
        place: function (p) { return p; },
        sep: ": ",
        date: function (iso) {
          var t = ymd(iso);
          return MON[t.m] + " " + t.d + ", " + t.y;
        },
        months: function (a, b) { var t = ymd(a); return MON[t.m] + (b ? "–" + MON[ymd(b).m] : "") + " " + t.y; },
        hour: function (h) { return (h % 12 || 12) + (h < 12 ? " am" : " pm"); },
        hourShort: function (h) { return h % 12 ? String(h % 12) : T.en.hour(h); },
        range: function (h) { return ap(h) + "–" + ap(h + 1); },
        when: function (iso, h) { return T.en.date(iso) + " · " + (h % 12 || 12) + "–" + ap(h + 1); },
        total: "Total photos", asOf: "As of ",
        topYear: "Busiest year", topMonth: "Busiest month",
        year: function (y) { return String(y); }, yearTick: function (y) { return String(y); },
        monthName: function (i) { return MONTH[i]; }, monthTick: function (i) { return MON[i]; },
        monthShort: function (i) { return MON[i].charAt(0); }, allYears: "all years combined",
        byYear: "Photos by year", byMonth: "Photos by month, all years combined", byCountry: "Photos by country/territory",
        allAria: "All photos, by year, month and country",
        bigTrip: "Biggest trip", perDay: "Most per day",
        days: function (n) { return n + " days"; },
        byTrip: "Images by trip, top 10",
        trip: function (t) { return t[3] + " days · " + fmt(t[5]) + "/day"; },
        tripAria: "The biggest trips, top 10",
        topHour: "Busiest hour", topDay: "Busiest day",
        byHour: "Photos by hour of day", topDays: "Busiest days",
        dayAria: "Photos by hour of day, and the busiest days",
        peak: "Busiest clock hour", topHours: "Busiest single hours",
        peakAria: "The busiest clock hour, and the busiest single hours",
        field: "Days in the field", run: "Longest run", mostYear: "Most in a year",
        span: function (a, b) { return T.en.months(a) + " – " + T.en.months(b); },
        twice: function (w) { return "twice: " + w.map(function (m) { return T.en.months(m); }).join(", "); },
        fieldByYear: "Days in the field by year", fieldByMonth: "Days in the field by month, all years combined",
        fieldShare: function (p) { return p + " of all days in the field"; },
        fieldAria: "Days in the field, by year and month"
      },
      zh: {
        rough: function (n) { return !n ? "0" : n < 500 ? "<0.1" : (n / 10000).toFixed(1); },
        share: function (p) { return "占全部照片的" + p; },
        n: function (n) { return fmt(n) + "张"; },
        images: function (n) { return fmt(n) + "张"; },
        photos: "张", dayUnit: "天",
        place: function (p) { return ZH_PLACE[p] || p; },
        sep: "：",
        date: function (iso) {
          var t = ymd(iso);
          return t.y + "年" + (t.m + 1) + "月" + t.d + "日";
        },
        months: function (a, b) { var t = ymd(a); return t.y + "年" + (t.m + 1) + (b ? "–" + (ymd(b).m + 1) : "") + "月"; },
        hour: function (h) { return h + "点"; },
        hourShort: function (h) { return String(h); },
        range: function (h) { return h + "–" + (h + 1) + "点"; },
        when: function (iso, h) { return T.zh.date(iso) + " · " + T.zh.range(h); },
        total: "照片总数", asOf: "截至",
        topYear: "拍得最多的一年", topMonth: "拍得最多的月份",
        year: function (y) { return y + "年"; }, yearTick: function (y) { return String(y); },
        monthName: function (i) { return (i + 1) + "月"; }, monthTick: function (i) { return (i + 1) + "月"; },
        monthShort: function (i) { return String(i + 1); }, allYears: "历年总计",
        byYear: "每年的照片数（万张）", byMonth: "一年中每个月的照片数（历年总计，万张）", byCountry: "各国家/地区的照片数",
        allAria: "全部照片：按年份、月份和国家/地区",
        bigTrip: "拍得最多的一次旅行", perDay: "日均最多",
        days: function (n) { return n + "天"; },
        byTrip: "拍得最多的十次旅行（张）",
        trip: function (t) { return t[3] + "天 · 平均每天" + fmt(t[5]) + "张"; },
        tripAria: "拍得最多的十次旅行",
        topHour: "拍得最多的时段（历年总计）", topDay: "拍得最多的一天",
        byHour: "一天中每个小时的照片数（历年总计，万张）", topDays: "拍得最多的十天",
        dayAria: "每个小时的照片数，以及拍得最多的十天",
        peak: "拍得最多的一小时", topHours: "拍得最多的十个小时",
        peakAria: "拍得最多的一小时，以及拍得最多的十个小时",
        field: "外拍天数（历年总计）", run: "最长连续外拍", mostYear: "一年最多",
        span: function (a, b) { return T.zh.months(a) + "–" + T.zh.months(b); },
        twice: function (w) { return "两次：" + w.map(function (m) { return T.zh.months(m); }).join("、"); },
        fieldByYear: "每年的外拍天数", fieldByMonth: "一年中每个月的外拍天数（历年总计）",
        fieldShare: function (p) { return "占全部外拍天数的" + p; },
        fieldAria: "外拍天数：按年份和月份"
      }
    };

    var RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
    var WIDE = 680;   // the box width at which blocks go two-column (site.css)
    var bound = false;

    function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function bindDoc() {
      if (bound) return;
      bound = true;
      // A tap outside a block clears it (focus leaving does too, but a tap
      // on plain text doesn't always move focus on a phone).
      document.addEventListener("pointerdown", function (e) {
        Array.prototype.forEach.call(document.querySelectorAll(".photo-numbers .nb-block.has-active"), function (b) {
          if (!b.contains(e.target) && b._nbClear) b._nbClear();
        });
      }, true);
    }

    // ---- One block: its readout (if it has one), its dials, its charts ----
    // opt: { cls, label, n, unit, ctx, dials: [[key, value, note?, unit?]], aria, listFirst }
    function Block(box, opt) {
      var blk = el("section", "nb-block nb-" + opt.cls);
      blk.setAttribute("aria-label", opt.aria);
      var inst = el("div", "nb-inst"), read = null, lab, num, val, ctx;
      if (opt.n != null) {
        read = el("div", "nb-read");
        lab = el("div", "nb-label"); num = el("div", "nb-num"); ctx = el("div", "nb-ctx");
        // The number and its unit (Newton: "this needs a unit"); only the number changes.
        val = num.appendChild(el("span", "nb-val"));
        if (opt.unit) num.appendChild(el("span", "nb-unit", opt.unit));
        read.appendChild(lab); read.appendChild(num); read.appendChild(ctx);
        inst.appendChild(read);
      }
      if (opt.dials) {
        var dials = el("div", "nb-dials");
        opt.dials.forEach(function (d) {
          var s = el("div", "nb-dial");
          s.appendChild(el("span", "nb-k", d[0]));
          var dv = s.appendChild(el("span", "nb-dv", d[1]));
          if (d[3]) dv.appendChild(el("span", "nb-unit", d[3]));
          if (d[2]) s.appendChild(el("span", "nb-note", d[2]));
          dials.appendChild(s);
        });
        inst.appendChild(dials);
      }
      blk.appendChild(inst);
      box.appendChild(blk);

      var charts = [], barSecs = [], listSecs = [];
      var shownN = opt.n, anim = 0;
      function setNum(n, ms) {
        if (!read) return;
        if (anim) cancelAnimationFrame(anim);
        anim = 0;
        if (!ms || RM.matches) { shownN = n; val.textContent = fmt(n); return; }
        var from = shownN, t0 = null;
        function step(now) {
          if (t0 === null) t0 = now;
          var t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
          shownN = from + (n - from) * e;
          val.textContent = fmt(shownN);
          anim = t < 1 ? requestAnimationFrame(step) : 0;
        }
        anim = requestAnimationFrame(step);
      }

      function head(sec, title) {
        var h = el("div", "nb-head");
        h.appendChild(el("span", "nb-title", title));
        sec.appendChild(h);
      }

      // Vertical bars on a hairline (years, months, hours), each named and
      // its rough count under it. rows: { tick, short, label, suf, n, xk,
      // ctx, aria }; short is the name in a narrow chart, xk the rough count.
      function bars(title, rows, kind) {
        var sec = el("div", "nb-chart nb-bars nb-" + kind);
        head(sec, title);
        var plot = el("div", "nb-plot");
        plot.setAttribute("role", "list");
        plot.setAttribute("aria-label", title);
        plot.style.setProperty("--n", rows.length);
        var max = Math.max.apply(null, rows.map(function (r) { return r.n; }));
        var group = [];
        rows.forEach(function (r, i) {
          var c = el("div", "nb-col");
          c.setAttribute("role", "listitem");
          c.tabIndex = -1;
          c.setAttribute("aria-label", r.aria);
          var well = el("div", "nb-well"), bar = el("div", "nb-bar");
          var v = max ? r.n / max : 0;
          bar.style.setProperty("--v", v);
          bar.style.setProperty("--i", i);
          if (r.n > 0 && v < 0.012) c.classList.add("is-tiny");
          if (!r.n) c.classList.add("is-zero");
          well.appendChild(bar);
          var tick = el("div", "nb-tick");
          tick.setAttribute("aria-hidden", "true");
          tick.appendChild(el("span", "nb-full", r.tick));
          tick.appendChild(el("span", "nb-short", r.short || r.tick));
          var xk = el("div", "nb-xk"), xs = el("span", null, r.xk);
          xk.setAttribute("aria-hidden", "true");
          xk.appendChild(xs);
          c.appendChild(well); c.appendChild(tick); c.appendChild(xk);
          plot.appendChild(c);
          var it = { el: c, label: r.label, suf: r.suf, n: r.n, ctx: r.ctx, group: group, i: i, xk: xs, rough: r.xk };
          c._nb = it;
          group.push(it);
        });
        group[0].el.tabIndex = 0;   // one stop per chart; the arrows move along it
        sec.appendChild(plot);
        blk.appendChild(sec);
        charts.push(sec); barSecs.push(sec);
      }

      // Horizontal bars, one row each (countries, trips, busiest days,
      // busiest hours), the count written in the row. rows: { p, s, n,
      // label, ctx, aria }. With a second line (s), the row is two lines:
      // what and count above, where and the bar below. foot: a closing
      // [label, value] line under the list.
      function list(title, rows, kind, foot) {
        var sec = el("div", "nb-chart nb-list nb-" + kind);
        head(sec, title);
        var ol = el("ol", "nb-rows");
        ol.setAttribute("aria-label", title);
        var max = Math.max.apply(null, rows.map(function (r) { return r.n; }));
        var group = [];
        rows.forEach(function (r, i) {
          var li = el("li", "nb-row" + (r.s ? " nb-two" : ""));
          li.tabIndex = -1;
          li.setAttribute("aria-label", r.aria);
          li.appendChild(el("span", "nb-p", r.p));
          if (r.s) li.appendChild(el("span", "nb-s", r.s));
          var track = el("span", "nb-track"), bar = el("span", "nb-hbar");
          var v = max ? r.n / max : 0;
          bar.style.width = (v * 100) + "%";
          if (r.n > 0 && v < 0.006) bar.style.minWidth = "1px";
          bar.style.setProperty("--i", i);
          track.setAttribute("aria-hidden", "true");
          track.appendChild(bar);
          li.appendChild(track);
          li.appendChild(el("span", "nb-n", fmt(r.n)));
          ol.appendChild(li);
          var it = { el: li, label: r.label, n: r.n, ctx: r.ctx, group: group, i: i };
          li._nb = it;
          group.push(it);
        });
        group[0].el.tabIndex = 0;
        sec.appendChild(ol);
        if (foot) {
          var f = el("div", "nb-foot");
          f.appendChild(el("span", "nb-k", foot[0]));
          f.appendChild(el("span", "nb-fv", foot[1]));
          sec.appendChild(f);
        }
        blk.appendChild(sec);
        charts.push(sec); listSecs.push(sec);
      }

      // ---- What is being read ---------------------------------------------
      var hover = null, pin = null, shown = undefined, leaveT = 0;
      function render(ms) {
        var it = hover || pin;
        if (it === shown) return;
        if (shown) {
          shown.el.classList.remove("is-active");
          if (shown.xk) shown.xk.textContent = shown.rough;
          shown.group.forEach(function (o) { o.el.classList.remove("is-near"); });
        }
        shown = it;
        blk.classList.toggle("has-active", !!it);
        if (it) {
          it.el.classList.add("is-active");
          // A bar's count turns exact; the counts beside it that it would
          // run into step aside.
          if (it.xk) {
            it.xk.textContent = fmt(it.n);
            var w = it.el.offsetWidth || 1, half = it.xk.offsetWidth / 2;
            it.group.forEach(function (o) {
              if (o !== it && Math.abs(o.i - it.i) * w < half + o.xk.offsetWidth / 2 + 8) o.el.classList.add("is-near");
            });
          }
        }
        if (!read) return;
        if (it && it.ctx) {
          lab.textContent = it.label;
          if (it.suf) lab.appendChild(el("span", "nb-suf", " · " + it.suf));
          ctx.textContent = it.ctx;
          setNum(it.n, ms == null ? 240 : ms);
        } else {
          lab.textContent = opt.label;
          ctx.textContent = opt.ctx;
          setNum(opt.n, ms == null ? 240 : ms);
        }
      }
      function clear() { hover = pin = null; clearTimeout(leaveT); render(); }
      blk._nbClear = clear;
      function itemOf(t) {
        var c = t && t.closest ? t.closest(".nb-col, .nb-row") : null;
        return c && blk.contains(c) ? c._nb : null;
      }
      function rove(it) {
        it.group.forEach(function (o) { o.el.tabIndex = o === it ? 0 : -1; });
      }

      function wire() {
        // Mouse: pointing reads a bar or row; off them it settles back (a
        // moment later, so crossing from one chart to the next doesn't
        // flicker).
        blk.addEventListener("pointerover", function (e) {
          if (e.pointerType !== "mouse") return;
          var it = itemOf(e.target);
          clearTimeout(leaveT);
          if (it) { hover = it; render(); }
          else if (hover) leaveT = setTimeout(function () { hover = null; render(); }, 140);
        });
        blk.addEventListener("pointerleave", function (e) {
          if (e.pointerType !== "mouse") return;
          clearTimeout(leaveT);
          leaveT = setTimeout(function () { hover = null; render(); }, 140);
        });
        // Click or tap: holds it; the same one again lets go. On a phone the
        // first tap reads it, a tap elsewhere clears it.
        var wasPinned = null;
        blk.addEventListener("pointerdown", function (e) {
          var it = itemOf(e.target);
          wasPinned = it && it === pin ? it : null;
          if (!it && e.pointerType !== "mouse" && pin) clear();
        });
        blk.addEventListener("click", function (e) {
          var it = itemOf(e.target);
          if (!it) return;
          if (wasPinned === it) { pin = null; hover = null; it.el.blur(); }
          else { pin = it; rove(it); }
          wasPinned = null;
          render();
        });
        blk.addEventListener("focusin", function (e) {
          var it = itemOf(e.target);
          if (!it) return;
          rove(it);
          pin = it;
          render();
        });
        blk.addEventListener("focusout", function (e) {
          if (e.relatedTarget && blk.contains(e.relatedTarget)) return;
          pin = null;
          render();
        });
        // Keys: Tab gives one stop per chart; the arrows (either axis), Home
        // and End move along it; Escape lets go.
        blk.addEventListener("keydown", function (e) {
          var it = itemOf(e.target);
          if (e.key === "Escape") {
            if (!hover && !pin) return;
            hover = pin = null; render();
            e.preventDefault();
            return;
          }
          if (!it) return;
          var g = it.group, to = null;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") to = g[Math.min(g.length - 1, it.i + 1)];
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = g[Math.max(0, it.i - 1)];
          else if (e.key === "Home") to = g[0];
          else if (e.key === "End") to = g[g.length - 1];
          else if (e.key === "Enter" || e.key === " ") { pin = it; render(); e.preventDefault(); return; }
          else return;
          e.preventDefault();
          if (to === it) { pin = it; render(); return; }
          rove(to);
          to.el.focus();
        });

        // ---- Entrance --------------------------------------------------------
        // Each chart's bars grow from their hairline, and the numeral counts
        // up, once, when each is first really on screen. Skipped for reduced
        // motion. (The English box is display:none until English is picked;
        // its blocks wait until then.)
        render(0);
        if (RM.matches || !window.IntersectionObserver) return;
        charts.forEach(function (c) { c.classList.add("nb-pre"); });
        if (read && !hover && !pin) { shownN = 0; val.textContent = "0"; }
        var io = new IntersectionObserver(function (es) {
          es.forEach(function (en) {
            if (!en.isIntersecting) return;
            io.unobserve(en.target);
            var t = en.target;
            if (t === read) {
              if (!hover && !pin) setNum(opt.n, 900);
              return;
            }
            requestAnimationFrame(function () {
              t.classList.add("nb-grow");
              t.classList.remove("nb-pre");
              setTimeout(function () { t.classList.remove("nb-grow"); }, 1600);
            });
          });
        }, { threshold: 0.35 });
        if (read) io.observe(read);
        charts.forEach(function (c) { io.observe(c); });
      }

      // Wide, with listFirst: the ranked list first (it sits beside the
      // numeral), then the bar charts below it, so Tab follows what is seen.
      // Narrow: the order they were built in. Only moved when that changes.
      var wideNow = false;
      function arrange(wide) {
        if (!opt.listFirst || wide === wideNow) return;
        wideNow = wide;
        (wide ? listSecs.concat(barSecs) : charts).forEach(function (c) { blk.appendChild(c); });
      }

      // The numeral and dials under the chart built so far (the hours of
      // the day: Newton wanted the big number beneath them).
      function under() { blk.appendChild(inst); }

      return { bars: bars, list: list, wire: wire, arrange: arrange, under: under };
    }

    function build(box, h) {
      bindDoc();
      var version = h.closest("[data-lang]"), L = T[version && version.getAttribute("data-lang") === "zh" ? "zh" : "en"];
      function share(n) {
        var p = n / D.total * 100;
        return L.share(!n ? "0%" : p < 0.1 ? "<0.1%" : p.toFixed(1) + "%");
      }
      box.setAttribute("role", "group");
      box.setAttribute("aria-labelledby", h.id);

      // ---- 1. All photos: by country, year and month -------------------------
      var topYear = D.years.reduce(function (a, b) { return b[1] > a[1] ? b : a; });
      var topMonth = 0;
      D.months.forEach(function (n, i) { if (n > D.months[topMonth]) topMonth = i; });
      var b1 = Block(box, {
        cls: "all", label: L.total, n: D.total, unit: L.photos, ctx: L.asOf + L.date(D.asOf),
        dials: [[L.topYear, String(topYear[0])], [L.topMonth, L.monthName(topMonth)]],
        aria: L.allAria, listFirst: true
      });
      b1.bars(L.byYear, D.years.map(function (y) {
        var s = String(y[0]);
        return { tick: L.yearTick(y[0]), short: "’" + s.slice(2), label: L.year(y[0]), n: y[1], xk: L.rough(y[1]),
          ctx: share(y[1]), aria: L.year(y[0]) + L.sep + L.n(y[1]) };
      }), "year");
      b1.bars(L.byMonth, D.months.map(function (n, i) {
        var name = L.monthName(i);
        return { tick: L.monthTick(i), short: L.monthShort(i), label: name, suf: L.allYears, n: n, xk: L.rough(n),
          ctx: share(n), aria: name + ", " + L.allYears + L.sep + L.n(n) };
      }), "month");
      b1.list(L.byCountry, D.countries.map(function (c) {
        var where = L.place(c[0]);
        return { p: where, n: c[1], label: where, ctx: share(c[1]), aria: where + L.sep + L.n(c[1]) + ", " + share(c[1]) };
      }), "country");
      b1.wire();

      // ---- 2. Days in the field: by year and by month ------------------------
      // Counts small enough to write in full under each bar.
      var F = D.field, fTotal = F.years.reduce(function (a, n) { return a + n; }, 0), fTop = 0;
      F.years.forEach(function (n, i) { if (n > F.years[fTop]) fTop = i; });
      function fShare(n) {
        var p = n / fTotal * 100;
        return L.fieldShare(!n ? "0%" : p.toFixed(1) + "%");
      }
      var bf = Block(box, {
        cls: "field", label: L.field, n: fTotal, unit: L.dayUnit, ctx: L.span(F.from, F.to),
        dials: [[L.run, L.days(F.run.days), L.twice(F.run.when)],
                [L.mostYear, L.days(F.years[fTop]), L.year(D.years[0][0] + fTop)]],
        aria: L.fieldAria
      });
      bf.bars(L.fieldByYear, F.years.map(function (n, i) {
        var y = D.years[0][0] + i, s = String(y);
        return { tick: L.yearTick(y), short: "’" + s.slice(2), label: L.year(y), n: n, xk: String(n),
          ctx: fShare(n), aria: L.year(y) + L.sep + L.days(n) };
      }), "year");
      bf.bars(L.fieldByMonth, F.months.map(function (n, i) {
        var name = L.monthName(i);
        return { tick: L.monthTick(i), short: L.monthShort(i), label: name, suf: L.allYears, n: n, xk: String(n),
          ctx: fShare(n), aria: name + ", " + L.allYears + L.sep + L.days(n) };
      }), "month");
      bf.wire();

      // ---- 3. The trips: the biggest, and the top ten ------------------------
      var top = D.trips[0];
      function when(t) { return L.months(t[1], t[2]); }
      var bt = Block(box, {
        cls: "trip", label: L.bigTrip, n: top[7], unit: L.photos, ctx: L.place(top[0]) + " · " + when(top),
        dials: [[L.perDay, fmt(D.mostPerDay.n), L.place(D.mostPerDay.where) + " · " + L.months(D.mostPerDay.when), L.photos]],
        aria: L.tripAria
      });
      bt.list(L.byTrip, D.trips.map(function (t) {
        var what = L.place(t[0]) + " · " + when(t);
        return { p: what, s: L.trip(t), n: t[7], label: what, ctx: L.trip(t),
          aria: what + ", " + L.trip(t) + L.sep + L.images(t[7]) };
      }), "trips");
      bt.wire();

      // ---- 4. The hours of the day, and the busiest days ---------------------
      var b2 = Block(box, {
        cls: "day", label: L.topHour, n: D.busiestHour.n, unit: L.photos, ctx: L.hour(D.busiestHour.hour),
        dials: [[L.topDay, fmt(D.busiestDays[0][2]), L.date(D.busiestDays[0][0]) + " · " + L.place(D.busiestDays[0][1]), L.photos]],
        aria: L.dayAria
      });
      b2.bars(L.byHour, D.hours.map(function (n, i) {
        return { tick: L.hour(i), short: L.hourShort(i), label: L.hour(i), n: n, xk: L.rough(n),
          ctx: share(n), aria: L.hour(i) + L.sep + L.n(n) };
      }), "hour");
      b2.under();   // the big number under the hours, then the busiest days
      b2.list(L.topDays, D.busiestDays.map(function (d) {
        var day = L.date(d[0]);
        var where = L.place(d[1]);
        return { p: day, s: where, n: d[2], label: day, aria: day + ", " + where + L.sep + L.n(d[2]) };
      }), "days");
      b2.wire();

      // ---- 5. The busiest clock hour, and the busiest single hours -----------
      var b3 = Block(box, {
        cls: "peak", label: L.peak, n: D.busiestHours[0][4], unit: L.photos,
        ctx: L.when(D.busiestHours[0][0], D.busiestHours[0][1]) + " · " + L.place(D.busiestHours[0][2]),
        aria: L.peakAria
      });
      b3.list(L.topHours, D.busiestHours.map(function (r) {
        var what = L.date(r[0]) + " · " + L.range(r[1]), where = L.place(r[2]);
        return { p: what, s: where, n: r[4], label: what, ctx: where, aria: what + ", " + where + L.sep + L.n(r[4]) };
      }), "hours");
      b3.wire();

      // Two columns or one follows the box (the English box is display:none,
      // so width 0, until English is picked).
      var blocks = [b1, bf, bt, b2, b3];
      function fit() {
        var wide = box.getBoundingClientRect().width >= WIDE;
        blocks.forEach(function (b) { b.arrange(wide); });
      }
      fit();
      if (window.ResizeObserver) new ResizeObserver(fit).observe(box);
      else window.addEventListener("resize", fit);
    }

    // A box right under each version's heading, whenever one is missing.
    function scan() {
      Array.prototype.forEach.call(document.querySelectorAll('.about-prose > h2[id="numbers"], .about-prose > h2[id="numbers-en"]'), function (h) {
        var next = h.nextElementSibling;
        if (next && next.classList.contains("photo-numbers")) return;
        var box = el("div", "photo-numbers");
        h.parentNode.insertBefore(box, h.nextSibling);
        build(box, h);
      });
    }
    if (window.MutationObserver) Array.prototype.forEach.call(proses, function (p) {
      new MutationObserver(scan).observe(p, { childList: true });
    });
    scan();
  })();

  // The About essay's figures, Newton's photographs for its "（图1）" marks
  // (the older "（figure 1）" still counts), wait in a <template
  // data-figures-for> beside the prose, not in it: the prose is an editable
  // slot that data/text.json rewrites, and edit.js's sanitiser would strip a
  // figure out of it. Each mark that has a figure becomes a link to it. A
  // figure with data-section belongs to a heading instead (his Hasselblad
  // beside 设备 / Gear). On a wide screen (his design, 2026-10-15) the rail
  // keeps its contents and holds a stage under them, each figure the
  // column's full width: the current one and the one before it, the newer
  // below, when both fit, else the current one alone; at each turn they move
  // up, in at the bottom and out at the top. A mark clicked shows its figure
  // until the reader scrolls on, and a photograph clicked opens full screen.
  // On a narrow screen each figure follows its paragraph (or heading), and a
  // mark scrolls to it. All of it is placed again whenever the prose is
  // rewritten or the window crosses 1000px, so the figures follow Newton's
  // marks through his edits; a mark with no figure stays plain text. None in
  // ?edit, or they would be saved into the essay.
  (function aboutFigures() {
    var tpl = document.querySelector("template[data-figures-for]");
    var prose = tpl && document.querySelector(tpl.getAttribute("data-figures-for"));
    var body = prose && prose.closest(".about-body");
    var rail = body && body.querySelector(".about-rail");
    if (!rail || !window.matchMedia || /[?&]edit\b/.test(location.search)) return;
    var MARK = /[（(]\s*(?:figure\s+|图\s*)([0-9a-z]+)\s*[）)]/gi;
    var wide = window.matchMedia("(min-width: 1001px)");
    var watch = window.MutationObserver && new MutationObserver(place);
    var stage = null, beside = null, items = [], pinned = -1, queued = false, under = { top: 0, h: 0 };

    function each(list, fn) { Array.prototype.forEach.call(list, fn); }
    function figure(key) { return tpl.content.querySelector('[data-figure="' + key + '"]:not([data-section])'); }
    // A section's heading in each version: #gear, #gear-en.
    function headings(name) {
      return body.querySelectorAll('.about-prose > h2[id="' + name + '"], .about-prose > h2[id="' + name + '-en"]');
    }
    function shownProse() {
      return Array.prototype.filter.call(body.querySelectorAll(".about-prose"), function (el) {
        return el.offsetParent !== null;
      })[0] || null;
    }

    function linkMarks() {
      each(prose.querySelectorAll(":scope > p"), function (p) {
        var walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nodes = [], t;
        while ((t = walk.nextNode())) if (!t.parentNode.closest("a")) nodes.push(t);
        nodes.forEach(function (t) {
          var s = t.data, at = 0, m, frag = null;
          MARK.lastIndex = 0;
          while ((m = MARK.exec(s))) {
            var key = m[1].toLowerCase();
            if (!figure(key)) continue;
            frag = frag || document.createDocumentFragment();
            frag.appendChild(document.createTextNode(s.slice(at, m.index)));
            var a = document.createElement("a");
            a.className = "fig-mark";
            a.href = "#figure-" + key;
            a.setAttribute("data-figure", key);
            a.textContent = m[0];
            frag.appendChild(a);
            at = m.index + m[0].length;
          }
          if (frag) {
            frag.appendChild(document.createTextNode(s.slice(at)));
            t.parentNode.replaceChild(frag, t);
          }
        });
      });
    }

    function place() {
      if (watch) watch.disconnect();
      each(body.querySelectorAll(".about-prose .about-fig"), function (f) { f.parentNode.removeChild(f); });
      if (stage) { stage.parentNode.removeChild(stage); stage = null; }
      if (beside) { beside.parentNode.removeChild(beside); beside = null; }
      rail.classList.remove("has-stage");
      linkMarks();
      items = [];
      var seen = {}, staged = wide.matches;
      each(prose.querySelectorAll(":scope > p"), function (p) {
        var after = p;
        each(p.querySelectorAll("a.fig-mark"), function (a) {
          var key = a.getAttribute("data-figure");
          if (seen[key]) return;   // a mark written twice shows its photograph once
          seen[key] = true;
          var fig = figure(key).cloneNode(true);
          fig.id = "figure-" + key;
          items.push({ key: key, fig: fig, mark: a, beside: fig.hasAttribute("data-beside") });
          if (!staged) { prose.insertBefore(fig, after.nextSibling); after = fig; }
        });
      });
      each(tpl.content.querySelectorAll("[data-section]"), function (t) {
        var name = t.getAttribute("data-section");
        // A section marked data-blank (My photography in numbers) shows no
        // figure: the stage empties and the contents come back up.
        if (t.hasAttribute("data-blank")) { if (staged) items.push({ key: name, section: name, blank: true, h: 0 }); return; }
        if (staged) items.push({ key: t.getAttribute("data-figure"), fig: t.cloneNode(true), section: name,
          beside: t.hasAttribute("data-beside"), under: t.hasAttribute("data-under") });
        else each(headings(name), function (h) { h.parentNode.insertBefore(t.cloneNode(true), h.nextSibling); });
      });
      if (staged && items.length) {
        stage = document.createElement("div");
        stage.className = "about-stage";
        items.forEach(function (it) {
          if (it.blank) return;
          if (!it.beside) return stage.appendChild(it.fig);
          if (!beside) { beside = document.createElement("div"); beside.className = "about-beside"; }
          beside.appendChild(it.fig);
        });
        rail.appendChild(stage);
        if (beside) rail.appendChild(beside);
        rail.classList.add("has-stage");
        // The text's column settles when its fonts arrive, and the stage
        // with it, so the figures are sized again whenever it changes.
        if (window.ResizeObserver) new ResizeObserver(function () { requestAnimationFrame(size); }).observe(stage);
      }
      pinned = -1;
      if (watch) watch.observe(prose, { childList: true });
      size();
    }

    // Every figure the stage's full width, or its full height for one too
    // tall for that (an upright, the square Hasselblad, a chart), centred
    // across the column then (Newton asked, 2026-10-15).
    // A figure marked data-beside (图1, Newton asked) sits beside the
    // contents, between them and the text, from the top of the rail; one
    // marked data-under (the Gear photograph) fills the space under them,
    // no lower than the rail can go at the foot of the page; the rest have
    // the whole column, the contents folded.
    function size() {
      reach();
      if (stage) {
        rail.style.height = "";   // measured at its full height
        var W = stage.clientWidth, H = stage.clientHeight;
        var nav = Array.prototype.filter.call(rail.querySelectorAll(".about-jump"), function (n) {
          return n.offsetParent !== null;
        })[0];
        var left = nav ? nav.offsetLeft + nav.offsetWidth + 32 : Math.round(W / 2);
        if (beside) beside.style.left = left + "px";
        // The rail sticks only as far as the end of the essay's column, so
        // at the foot of the page it has room for this much before it is
        // pushed up under the bar.
        var end = body.getBoundingClientRect().bottom + window.pageYOffset - (parseFloat(getComputedStyle(body).paddingBottom) || 0)
          - (document.documentElement.scrollHeight - window.innerHeight);
        // (It may rise 24px towards the bar, and stops 32px above the footer.)
        var room = Math.min(H, end - (parseFloat(getComputedStyle(rail).top) || 0) + 24 - 32);
        under.top = (nav ? nav.offsetTop + nav.offsetHeight : 0) + 32;
        under.h = Math.max(80, room - under.top);
        items.forEach(function (it) {
          if (it.blank) return;
          var img = it.fig.querySelector("img, .bird-map");
          var r = it.fig.hasAttribute("data-crop") ? 2 / 3 : img.getAttribute("height") / img.getAttribute("width");
          var aw = it.beside ? rail.clientWidth - left : W, ah = it.beside ? rail.clientHeight : it.under ? under.h : H;
          it.fig.style.width = aw + "px";
          // A caption wraps to more lines as the figure narrows, so fit
          // twice, the second time with the caption at the narrower width.
          var w = aw;
          for (var k = 0; k < 2; k++) {
            var cap = it.fig.offsetHeight - img.offsetHeight;
            if (aw * r + cap > ah) w = Math.min(w, Math.floor((ah - cap) / r));
            it.fig.style.width = w + "px";
          }
          it.fig.style.left = Math.floor((aw - w) / 2) + "px";
          it.h = it.fig.offsetHeight;
        });
      }
      update();
    }

    // A wide section (My photography in numbers) takes the open width from
    // the contents to the text's right edge: how far left of the text it
    // reaches, a column gap clear of the contents (site.css --about-reach).
    function reach() {
      var nav = Array.prototype.filter.call(rail.querySelectorAll(".about-jump"), function (n) {
        return n.offsetParent !== null;
      })[0], text = shownProse();
      if (!wide.matches || !nav || !text) return body.style.removeProperty("--about-reach");
      var gap = parseFloat(getComputedStyle(body).columnGap) || 48;
      body.style.setProperty("--about-reach", Math.max(0, Math.floor(text.getBoundingClientRect().left - nav.getBoundingClientRect().right - gap)) + "px");
    }

    // When each essay figure comes in, as a scroll position: as near as can
    // be to where the reading line passes its mark, but each held for at
    // least `hold` of scrolling and all of them before `end` (where 设备
    // takes over), so marks a line apart (图1 and 图2) don't flash by and 图8
    // gets its turn; the figures after a cluster run a little late and catch
    // up in the longer stretches between marks. Least squares under those
    // limits: pool adjacent violators on each position less i × hold,
    // clamped to the range.
    function spread(marks, hold, start, end) {
      var pools = [];
      marks.forEach(function (m, i) {
        pools.push({ sum: m - i * hold, n: 1 });
        while (pools.length > 1) {
          var a = pools[pools.length - 2], b = pools[pools.length - 1];
          if (a.sum / a.n <= b.sum / b.n) break;
          a.sum += b.sum; a.n += b.n; pools.pop();
        }
      });
      var at = [];
      pools.forEach(function (p) {
        var c = Math.min(Math.max(start, p.sum / p.n), end - marks.length * hold);
        for (var k = 0; k < p.n; k++) at.push(c + at.length * hold);
      });
      return at;
    }

    function update() {
      queued = false;
      if (!stage) return;
      var version = shownProse(), essay = version === prose, current = -1;
      var scrolled = window.pageYOffset, line = window.innerHeight * 0.6;
      var last = document.documentElement.scrollHeight - window.innerHeight;
      // A section's figure takes over once its heading reaches the reading
      // line (or the page can't scroll that far), the lowest such heading
      // on the page. A blank section (My photography in numbers) clears the
      // stage sooner, while its heading is still a little below the window,
      // so the figure before it is gone before its charts come up beside
      // it; and it keeps the stage clear until its charts have gone up past
      // the top of the Gear photograph under the contents (Newton: they must
      // never overlap, 2026-10-16).
      var end = last, lowest = -Infinity, clear = -1;
      var below = items.filter(function (it) { return it.under; })[0];
      var floor = rail.getBoundingClientRect().top + under.top + (below ? Math.max(0, (under.h - below.h) / 2) : 0) - 24;
      items.forEach(function (it, i) {
        if (!it.section) return;
        var h = version && version.querySelector(':scope > h2[id^="' + it.section + '"]');
        if (!h) return;
        var top = h.getBoundingClientRect().top;
        var at = Math.min(scrolled + top - (it.blank ? window.innerHeight * 1.1 : line), last);
        end = Math.min(end, at);
        if (scrolled >= at - 1 && at >= lowest) { current = i; lowest = at; }
        if (it.blank && scrolled >= at - 1) {
          var foot = h;
          while (foot.nextElementSibling && foot.nextElementSibling.tagName !== "H2") foot = foot.nextElementSibling;
          if (foot.getBoundingClientRect().bottom > floor) clear = i;
        }
      });
      if (clear >= 0) current = clear;
      var marked = items.filter(function (it) { return it.mark; });
      if (current < 0 && essay && marked.length) {
        // None before the rail has stuck under the bar, so the first figure
        // has its turn while the stage comes into view and after.
        var start = Math.max(0, scrolled + body.getBoundingClientRect().top - (parseFloat(getComputedStyle(rail).top) || 0));
        var hold = Math.max(1, Math.min(Math.max(160, window.innerHeight * 0.25), (end - start) / marked.length));
        var from = spread(marked.map(function (it) { return scrolled + it.mark.getBoundingClientRect().top - line; }),
          hold, start, end);
        current = 0;
        from.forEach(function (at, i) { if (scrolled >= at - 1) current = i; });
        // Nothing until the reader reaches the essay: the first figure comes
        // in once its mark is up in the window (Newton: not with the cover
        // still filling the screen, but once 图1's line is on it).
        if (current === 0 && marked[0].mark.getBoundingClientRect().top > window.innerHeight * 0.85) current = -1;
      }
      if (pinned >= 0) current = pinned;
      var H = stage.clientHeight, gap = 32, shown = current < 0 ? [] : [current];
      function alone(i) { return items[i].beside || items[i].under || items[i].blank; }
      function pairs(a, b) { return essay && !alone(a) && !alone(b) && items[a].h + gap + items[b].h <= H; }
      if (current > 0 && pairs(current - 1, current)) shown = [current - 1, current];
      else if (current === 0 && items.length > 1 && pairs(0, 1)) shown = [0, 1];
      var inStage = shown.filter(function (i) { return !alone(i); });
      var y = inStage.length ? Math.max(0, (H - inStage.reduce(function (sum, i) { return sum + items[i].h; }, 0) - gap * (inStage.length - 1)) / 2) : 0;
      items.forEach(function (it, i) {
        if (it.blank) return;
        var n = shown.indexOf(i);
        if (it.beside) it.y = n >= 0 ? 0 : i < current ? -24 : 24;
        else if (it.under && n >= 0) it.y = under.top + Math.max(0, (under.h - it.h) / 2);
        else if (n >= 0) { it.y = y; y += it.h + gap; }
        else it.y = shown.length && i < shown[0] ? -it.h - gap : H + gap;
        it.fig.style.setProperty("--y", Math.round(it.y) + "px");
        it.fig.classList.toggle("is-in", n >= 0);
        it.fig.classList.toggle("is-current", i === current);
      });
      // The contents stay up beside 图1 and the Gear photograph (and before
      // any figure); they fold away for the rest.
      var folded = current >= 0 && !alone(current);
      rail.classList.toggle("is-folded", folded);
      // With the contents up the rail is only as tall as they and the figure
      // beside them, or at the foot of the page the end of the essay's
      // column would push it, contents and all, up under the bar.
      if (folded) rail.style.height = "";
      else {
        var nav = Array.prototype.filter.call(rail.querySelectorAll(".about-jump"), function (n) {
          return n.offsetParent !== null;
        })[0];
        var need = nav ? nav.offsetTop + nav.offsetHeight : 0;
        if (current >= 0) need = items[current].under ? under.top + under.h + 32 : Math.max(need, items[current].h);
        rail.style.height = Math.ceil(need) + "px";
      }
      var lit = essay && current >= 0 && items[current].mark ? items[current].key : null;
      each(prose.querySelectorAll("a.fig-mark"), function (a) {
        a.classList.toggle("is-current", a.getAttribute("data-figure") === lit);
      });
    }

    function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
    function unpin() { if (pinned >= 0) { pinned = -1; queue(); } }

    prose.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a.fig-mark");
      if (!a) return;
      var key = a.getAttribute("data-figure"), i = -1;
      items.forEach(function (it, n) { if (it.mark && it.key === key) i = n; });
      if (i < 0) return;
      e.preventDefault();
      if (stage) { pinned = i; update(); }
      else items[i].fig.scrollIntoView({ block: "center" });
    });
    ["wheel", "touchmove", "keydown"].forEach(function (type) {
      window.addEventListener(type, unpin, { passive: true });
    });

    // A photograph clicked opens full screen, the whole frame; a click or
    // Esc closes it.
    body.addEventListener("click", function (e) {
      var img = e.target.closest && e.target.closest(".about-fig img");
      if (img) zoom(img.src, img.srcset, img.alt);
    });

    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", function () { requestAnimationFrame(size); });
    window.addEventListener("nl:lang", function () { requestAnimationFrame(size); });
    window.addEventListener("load", queue);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
    if (wide.addEventListener) wide.addEventListener("change", place);
    else if (wide.addListener) wide.addListener(place);
    place();
  })();

  // The full-screen view: one picture on the ground, a click or Esc closes
  // it. The About figures use it, and so does any link with class "zoom"
  // (the XHS handle opens his profile card, 2026-10-16); without the script
  // that link simply opens the picture.
  function zoom(src, srcset, alt) {
    var back = document.activeElement;
    var box = document.createElement("div");
    box.className = "fig-zoom";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", alt);
    box.tabIndex = -1;
    var big = document.createElement("img");
    big.alt = alt;
    if (srcset) { big.sizes = "100vw"; big.srcset = srcset; }
    big.src = src;
    box.appendChild(big);
    function close() {
      if (box.parentNode) box.parentNode.removeChild(box);
      document.removeEventListener("keydown", key, true);
      if (back && back.focus) back.focus();
    }
    function key(ev) { if (ev.key === "Escape") { ev.preventDefault(); close(); } }
    box.addEventListener("click", close);
    document.addEventListener("keydown", key, true);
    document.body.appendChild(box);
    box.focus();
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.zoom");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    zoom(a.href, "", a.textContent);
  });

  /* ---------- About: the eBird map (图1) -------------------------------- */
  // Newton's eBird life list on a map, the world by country, shaded from
  // yellow to red by species (eBird's own scale). Hover a country for its
  // count (on a phone, tap); every country he has birded in opens into its
  // states, provinces or regions. Paths and counts are data/birdmap.json,
  // built by tools/birdmap.py from Natural Earth and his eBird export. Each
  // .bird-map is built when it appears: the About figures are cloned from
  // their template whenever the layout changes. One look for both grounds,
  // drawn in the page's own colours (Newton, 2026-10-16).
  (function birdMap() {
    var NS = "http://www.w3.org/2000/svg";
    var STOPS = [[0, [234, 217, 138]], [0.5, [227, 154, 108]], [1, [214, 74, 90]]];
    var cache = {};

    function color(n, max) {
      var t = max > 0 ? Math.min(1, n / max) : 0, i = t <= STOPS[1][0] ? 0 : 1;
      var a = STOPS[i], b = STOPS[i + 1], u = (t - a[0]) / (b[0] - a[0]);
      return "rgb(" + a[1].map(function (c, k) { return Math.round(c + (b[1][k] - c) * u); }).join(",") + ")";
    }
    function el(tag, cls, ns) {
      var e = ns ? document.createElementNS(NS, tag) : document.createElement(tag);
      if (cls) e.setAttribute("class", cls);
      return e;
    }
    function load(src) {
      if (!cache[src]) cache[src] = fetch(src).then(function (r) { return r.json(); });
      return cache[src];
    }
    function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

    function build(box, data) {
      var views = {}, current = "world", hot = null, armed = null, touch = false, busy = false;
      box.textContent = "";
      var head = el("div", "bm-head"), crumb = el("button", "bm-crumb"), here = el("span", "bm-here"),
          total = el("span", "bm-total");
      crumb.type = "button";
      crumb.textContent = "World";
      head.appendChild(crumb); head.appendChild(here); head.appendChild(total);
      var stage = el("div", "bm-views"), legend = el("div", "bm-legend"),
          lo = el("span"), bar = el("i"), hi = el("span");
      lo.textContent = "0";
      legend.appendChild(lo); legend.appendChild(bar); legend.appendChild(hi);
      var tip = el("div", "bm-tip"), tipName = el("b"), tipN = el("span"), tipMore = el("em");
      tip.appendChild(tipName); tip.appendChild(tipN); tip.appendChild(tipMore);
      box.appendChild(head); box.appendChild(stage); box.appendChild(legend); box.appendChild(tip);
      bar.style.background = "linear-gradient(90deg," + STOPS.map(function (s) {
        return "rgb(" + s[1].join(",") + ") " + s[0] * 100 + "%"; }).join(",") + ")";

      function view(key) {
        if (views[key]) return views[key];
        var v = data[key], max = 0;
        v.shapes.forEach(function (s) { max = Math.max(max, s.n); });
        var svg = el("svg", "bm-view", true);
        svg.setAttribute("viewBox", "0 0 " + v.w + " " + v.h);
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", data.names[key] + ": species observed by " + (key === "world" ? "country" : "state or province"));
        if (v.outline) { var o = el("path", "bm-outline", true); o.setAttribute("d", v.outline); svg.appendChild(o); }
        var rest = el("path", "bm-rest", true); rest.setAttribute("d", v.rest); svg.appendChild(rest);
        var g = el("g", "bm-shapes", true);
        v.shapes.slice().sort(function (a, b) { return a.n - b.n; }).forEach(function (s) {
          var p = el("path", "bm-shape", true);
          p.setAttribute("d", s.d);
          p.setAttribute("fill", color(s.n, max));
          p.setAttribute("data-k", s.k);
          if (s.drill) p.setAttribute("data-drill", s.drill);
          g.appendChild(p);
          if (s.dot) {
            var c = el("circle", "bm-dot", true);
            c.setAttribute("cx", s.dot[0]); c.setAttribute("cy", s.dot[1]);
            c.setAttribute("r", key === "world" ? 3.5 : 5);
            c.setAttribute("fill", color(s.n, max));
            c.setAttribute("data-k", s.k);
            g.appendChild(c);
          }
        });
        svg.appendChild(g);
        stage.appendChild(svg);
        var byK = {};
        v.shapes.forEach(function (s) { byK[s.k] = s; });
        return (views[key] = { svg: svg, max: max, byK: byK, data: v });
      }

      function label(key) {
        var world = key === "world";
        crumb.classList.toggle("is-link", !world);
        crumb.disabled = world;
        here.textContent = world ? "" : data.names[key];
        var n = world ? data.total : views.world.byK[findDrill(key)].n;
        total.textContent = fmt(n) + " species";
        hi.textContent = fmt(views[key].max);
      }
      function findDrill(key) {
        var k = null;
        data.world.shapes.forEach(function (s) { if (s.drill === key) k = s.k; });
        return k;
      }

      function setHot(t) {
        if (hot === t) return;
        if (hot) hot.classList.remove("is-hot");
        hot = t;
        if (hot) {
          hot.classList.add("is-hot");
          hot.parentNode.appendChild(hot);   // its outline above its neighbours'
        }
      }
      function showTip(t, x, y) {
        var v = views[current], s = v.byK[t.getAttribute("data-k")];
        tipName.textContent = s.name;
        tipN.textContent = fmt(s.n) + " species observed";
        tipMore.textContent = s.drill ? (touch ? "Tap again for " : "Click for ") + s.parts : "";
        tip.classList.add("is-on");
        var r = box.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
        var left = x - r.left + 14, top = y - r.top + 14;
        if (left + w > r.width - 4) left = x - r.left - w - 14;
        if (top + h > r.height - 4) top = y - r.top - h - 14;
        tip.style.transform = "translate(" + Math.max(4, left) + "px," + Math.max(4, top) + "px)";
      }
      function hideTip() { tip.classList.remove("is-on"); setHot(null); armed = null; }

      // The world eases in to the country's outline while its own map fades
      // up; back out, the reverse.
      function animate(svg, from, to, ms, done) {
        var t0 = null;
        function step(now) {
          if (t0 === null) t0 = now;
          var t = Math.min(1, (now - t0) / ms), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          svg.setAttribute("viewBox", from.map(function (a, i) { return a + (to[i] - a) * e; }).join(" "));
          if (t < 1) requestAnimationFrame(step); else if (done) done();
        }
        requestAnimationFrame(step);
      }
      function boxOf(key) {
        var shape = views.world.svg.querySelector('[data-drill="' + key + '"]'), b = shape.getBBox();
        var W = data.world.w, H = data.world.h, ar = W / H, w = b.width * 1.08, h = b.height * 1.08;
        if (w / h < ar) w = h * ar; else h = w / ar;
        return [b.x + b.width / 2 - w / 2, b.y + b.height / 2 - h / 2, w, h];
      }
      function go(key) {
        if (busy || key === current) return;
        busy = true; hideTip();
        var world = views.world, full = [0, 0, data.world.w, data.world.h];
        var target = view(key === "world" ? current : key);
        var into = key !== "world", zoomed = boxOf(into ? key : current);
        target.svg.classList.add("is-shown");
        box.classList.add("is-moving");
        if (into) {
          target.svg.style.opacity = 0;
          animate(world.svg, full, zoomed, 520, function () {
            world.svg.classList.remove("is-shown"); world.svg.setAttribute("viewBox", full.join(" "));
            box.classList.remove("is-moving"); busy = false;
          });
          setTimeout(function () { target.svg.style.opacity = ""; world.svg.style.opacity = 0; }, 180);
        } else {
          world.svg.classList.add("is-shown");
          world.svg.setAttribute("viewBox", zoomed.join(" "));
          world.svg.style.opacity = 0;
          requestAnimationFrame(function () {
            target.svg.style.opacity = 0; world.svg.style.opacity = "";
            animate(world.svg, zoomed, full, 520, function () {
              target.svg.classList.remove("is-shown"); target.svg.style.opacity = "";
              box.classList.remove("is-moving"); busy = false;
            });
          });
        }
        current = key;
        label(key);
      }

      box.addEventListener("pointerdown", function (e) { touch = e.pointerType !== "mouse"; });
      box.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse" || busy) return;
        var t = e.target.closest && e.target.closest("[data-k]");
        if (!t || !box.contains(t)) { hideTip(); return; }
        setHot(views[current].svg.querySelector('path[data-k="' + t.getAttribute("data-k") + '"]') || t);
        showTip(t, e.clientX, e.clientY);
        box.style.cursor = t.hasAttribute("data-drill") || views[current].byK[t.getAttribute("data-k")].drill ? "pointer" : "";
      });
      box.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hideTip(); });
      stage.addEventListener("click", function (e) {
        if (busy) return;
        var t = e.target.closest && e.target.closest("[data-k]");
        if (!t) { hideTip(); return; }
        var s = views[current].byK[t.getAttribute("data-k")];
        if (touch && armed !== s.k) {
          armed = s.k;
          setHot(views[current].svg.querySelector('path[data-k="' + s.k + '"]') || t);
          showTip(t, e.clientX, e.clientY);
          return;
        }
        if (s.drill) go(s.drill);
      });
      crumb.addEventListener("click", function () { go("world"); });
      box.addEventListener("keydown", function (e) { if (e.key === "Escape" && current !== "world") go("world"); });

      view("world").svg.classList.add("is-shown");
      label("world");
      box.setAttribute("data-ready", "");
    }

    function init(box) {
      if (box.hasAttribute("data-ready") || box.hasAttribute("data-loading")) return;
      box.setAttribute("data-loading", "");
      load(box.getAttribute("data-src")).then(function (data) {
        box.removeAttribute("data-loading");
        build(box, data);
      });
    }
    function scan() {
      Array.prototype.forEach.call(document.querySelectorAll(".bird-map:not([data-ready])"), init);
    }
    scan();
    if (window.MutationObserver) new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  })();

  /* ---------- Chinese text ---------------------------------------------- */

  // Any Chinese on the site, a blurb today or a title, subtitle or caption
  // later, is set in the typewriter pairing (--zh and :lang(zh), site.css).
  // It only has to be marked lang="zh-Hans", which also gets it simplified
  // glyphs, Chinese punctuation and a Chinese voice in a screen reader.
  // A text with more Han characters than Latin letters is marked whole, so
  // its English words and its sign-off are typed too; Chinese inside English
  // gets a span of its own. Pages keep writing text after they load (the
  // gallery header from collections.json, the globe's cards), so this
  // watches the page instead of being called from every place that writes,
  // and a text that turns English again loses the mark. It only undoes marks
  // it made (data-zh, data-zh-run) and leaves alone anything given a language
  // by hand. Text being typed in ?edit is never split: a field that becomes
  // editable loses its spans, or English typed after a Chinese word would
  // land inside one, so Chinese inside English shows in the system face
  // until the page is reloaded. The web fonts for devices without Songti
  // load the first time Chinese turns up, so a page without any never asks
  // for them.
  (function chineseText() {
    var FONTS = "https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Noto+Serif+SC:wght@400;700&display=swap";
    var HAN = /[㐀-鿿豈-﫿]/;
    var HAN_ALL = /[㐀-鿿豈-﫿]/g;
    var LATIN_ALL = /[A-Za-z]/g;
    // A run: Han characters with the Chinese punctuation around them.
    var RUN = /[　-〿＀-￯]*[㐀-鿿豈-﫿][　-〿㐀-鿿豈-﫿＀-￯]*/g;
    var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|TITLE|OPTION)$/;
    var XHTML = "http://www.w3.org/1999/xhtml";
    var fontsAsked = false;

    function mostlyChinese(text) {
      return (text.match(HAN_ALL) || []).length > (text.match(LATIN_ALL) || []).length;
    }

    // A paragraph in a page of prose that is mostly Chinese is Chinese too,
    // even one that quotes a long English sentence (the About essay).
    function inChinese(p) {
      var page = p.parentElement && p.parentElement.closest("[data-edit-rich]");
      return !!page && mostlyChinese(page.textContent);
    }

    function askFonts() {
      if (fontsAsked) return;
      fontsAsked = true;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONTS;
      document.head.appendChild(link);
    }

    // The elements holding Chinese text under (or at) a node.
    function holders(node, into) {
      if (node.nodeType === 3) {
        if (node.parentElement && HAN.test(node.data)) into.push(node.parentElement);
        return;
      }
      if (node.nodeType !== 1) return;
      var walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), t;
      while ((t = walk.nextNode())) {
        if (t.parentElement && HAN.test(t.data)) into.push(t.parentElement);
      }
    }

    function wrap(textNode) {
      var s = textNode.data, at = 0, m;
      var frag = document.createDocumentFragment();
      RUN.lastIndex = 0;
      while ((m = RUN.exec(s))) {
        if (m.index > at) frag.appendChild(document.createTextNode(s.slice(at, m.index)));
        var span = el("span");
        span.lang = "zh-Hans";
        span.setAttribute("data-zh-run", "");
        span.textContent = m[0];
        frag.appendChild(span);
        at = m.index + m[0].length;
      }
      if (at < s.length) frag.appendChild(document.createTextNode(s.slice(at)));
      textNode.parentNode.replaceChild(frag, textNode);
    }

    function settle(p) {
      if (!p.isConnected || p.hasAttribute("data-zh-run")) return;
      if (p.closest(".lang-toggle")) return;   // its 中 alone doesn't fetch fonts
      if (SKIP.test(p.nodeName) || p.namespaceURI !== XHTML) return;
      var text = p.textContent;
      if (p.hasAttribute("data-zh")) {
        if (mostlyChinese(text) || inChinese(p)) return;
        // Turned English: unmark it, then mark any Chinese still inside.
        p.removeAttribute("lang");
        p.removeAttribute("data-zh");
        var inner = [];
        holders(p, inner);
        inner.forEach(settle);
        return;
      }
      if (!HAN.test(text)) return;
      var given = p.closest("[lang]");
      var lang = given ? given.getAttribute("lang") : "";
      if (/^zh/i.test(lang)) { askFonts(); return; }   // inside Chinese already
      if (lang && !/^en/i.test(lang)) return;          // another language, by hand
      if (given !== p && (mostlyChinese(text) || inChinese(p))) {
        p.lang = "zh-Hans";
        p.setAttribute("data-zh", "");
        askFonts();
        return;
      }
      if (p.isContentEditable) return;
      for (var n = p.firstChild, next; n; n = next) {
        next = n.nextSibling;
        if (n.nodeType === 3 && HAN.test(n.data)) wrap(n);
      }
      askFonts();
    }

    function settleAll(list) {
      list.forEach(function (p, i) { if (list.indexOf(p) === i) settle(p); });
    }

    function unwrap(run) {
      var p = run.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(run.textContent), run);
      p.normalize();
    }

    var first = [];
    holders(document.body, first);
    settleAll(first);

    if (!window.MutationObserver) return;
    new MutationObserver(function (records) {
      var marked = [], fresh = [];
      records.forEach(function (r) {
        var at = r.type === "characterData" ? r.target.parentElement : r.target;
        if (!at) return;
        if (r.type === "attributes") {
          // contenteditable: ?edit armed this field, or let it go.
          if (at.isContentEditable) {
            Array.prototype.forEach.call(at.querySelectorAll("[data-zh-run]"), unwrap);
          }
          holders(at, fresh);
          return;
        }
        if (at.hasAttribute("data-zh-run")) {   // text written into a span: start over
          var host = at.parentElement;
          unwrap(at);
          if (host) fresh.push(host);
          return;
        }
        // Every mark around the change, as an inner text turning English can
        // tip the one around it too.
        for (var w = at.closest("[data-zh]"); w; w = w.parentElement && w.parentElement.closest("[data-zh]")) {
          marked.push(w);
        }
        if (r.type === "characterData") holders(r.target, fresh);
        else for (var i = 0; i < r.addedNodes.length; i++) holders(r.addedNodes[i], fresh);
      });
      // Marks that may have to come off go first, outermost first, so the
      // Chinese inside a text that turned English is found again below.
      marked.sort(function (a, b) {
        return a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1;
      });
      settleAll(marked);
      settleAll(fresh);
    }).observe(document.body, {
      childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ["contenteditable"]
    });
  })();

  /* ---------- home ---------------------------------------------------- */

  function renderHome(collections, photos) {
    var grid = document.getElementById("collection-grid");

    // Hero: whichever photo is flagged `featured`, else the most recent.
    var hero = photos.filter(function (p) { return p.featured; })[0] || photos[0];
    var heroMedia = document.getElementById("hero-media");
    if (hero && heroMedia) {
      // A background-image can't carry a srcset, so pick the width here. The
      // hero is set once and never resized, so there is no handler to add.
      heroMedia.style.backgroundImage =
        "url('" + url(pickForWidth(hero, window.innerWidth)) + "')";
    }

    var byCollection = {};
    photos.forEach(function (p) {
      (byCollection[p.collection] = byCollection[p.collection] || []).push(p);
    });

    if (!collections.length) { status(grid, tr("No collections defined yet.")); return; }

    grid.textContent = "";
    // Newest trip first (Newton, 2026-10-17); collections.json stays oldest
    // first, the order the globe's pins arrive in.
    collections.slice().reverse().forEach(function (c) {
      var shots = byCollection[c.slug] || [];
      var cover = c.cover
        ? photos.filter(function (p) { return p.src === c.cover; })[0] || { src: c.cover }
        : shots[0];

      var card = el("a", "collection-card" + (shots.length ? "" : " is-empty"));
      card.href = BASE + "collections/" + c.slug + "/";

      if (cover) {
        var img = el("img");
        // Cards are a 20rem-minimum auto-fill grid inside --wrap, so they land
        // near 380px on a desktop and go full width on a phone. A cover wider
        // than 3:2 is cropped to fill the card, so it is drawn that much
        // wider than the card: the hint grows with it.
        var wide = Math.max(1, aspectOf(cover) / 1.5);
        responsive(img, cover, "(max-width: 700px) " + Math.round(100 * wide) + "vw, " +
                   Math.round(380 * wide) + "px", cover.thumb || cover.src);
        img.alt = "";                    // decorative; the title carries meaning
        img.loading = "lazy";
        img.decoding = "async";
        card.appendChild(img);
      }

      // No photo counts, here or anywhere else — a collection is a body of
      // work, not a tally.
      var bodyEl = el("div", "card-body");
      var title = el("h3", "card-title");
      title.textContent = placeName(c.title);       // his own titles stay English (ZH_PLACES)
      bodyEl.appendChild(title);

      if (c.subtitle) {
        var sub = el("p", "card-sub");
        sub.textContent = c.subtitle;
        bodyEl.appendChild(sub);
      }
      card.appendChild(bodyEl);
      grid.appendChild(card);
    });
  }

  /* ---------- gallery -------------------------------------------------- */

  var lightbox, lbImage, lbTitle, lbMeta, lbExif, lbName;
  var shown = [];      // photos currently in the grid — what the arrows walk
  var index = -1;
  var isOpen = false;
  var lbReturn = null; // where focus goes back to on close (NLSite.viewer)

  function exifLine(photo) {
    var e = photo.exif;
    if (!CAPTIONS.lightbox.exif || !e) return "";
    return EXIF_FIELDS
      .map(function (field) {
        if (!e[field]) return "";
        return field === "iso" ? "ISO " + e[field] : e[field];
      })
      .filter(Boolean)
      .join("  ·  ");
  }

  // The bird's English name, its scientific name beside it, the pair a link
  // to the species on eBird when photos.json carries the code. In Chinese
  // its Chinese name ("zh", eBird's zh_SIM) comes first, then the two.
  function nameLine(photo) {
    lbName.textContent = "";
    if (!CAPTIONS.lightbox.caption || !photo.caption) return;
    var to = lbName;
    if (photo.ebird) {
      to = lbName.appendChild(el("a", "lb-ebird"));
      to.href = "https://ebird.org/species/" + encodeURIComponent(photo.ebird);
      to.target = "_blank";
      to.rel = "noopener";
    }
    if (LANG === "zh" && photo.zh) setText(to.appendChild(el("span", "lb-zh")), photo.zh);
    to.appendChild(document.createTextNode(photo.caption));
    if (photo.sci) to.appendChild(el("i", "lb-sci")).textContent = photo.sci;
    if (photo.ebird) {
      var out = to.appendChild(el("span", "lb-out"));
      out.textContent = "\u2197";
      out.setAttribute("aria-hidden", "true");
    }
  }

  function metaLine(photo) {
    return [
      CAPTIONS.lightbox.location && photo.location,
      CAPTIONS.lightbox.date && formatDate(photo.date)
    ].filter(Boolean).join("  ·  ");
  }

  /* ------------------------------------------------------------------
     THE PACKED GRID

     Photographs may be cropped, including to a square, but never across the
     divide: a landscape stays a landscape and an upright stays an upright.

     Each row has one anchor cell carrying an aspect-ratio; the rest stretch to
     the height it sets and take their width from a percentage. So rows sit
     flush at any window width with no measuring and no resize handler.

     Cell needs:  L landscape · P upright · S either, cropped square · W pano
     ------------------------------------------------------------------ */

  function famOf(photo) {
    var ar = aspectOf(photo);
    return ar >= 2.2 ? "W" : ar <= 0.92 ? "P" : "L";
  }

  function cellFits(need, photo) {
    if (need === "?") return true;                  // "?" takes any shape whole
    var f = famOf(photo);
    return need === "*" ? f !== "W" : need === f;   // "*" crops to a square
  }

  /* Row templates.

     `need` is the family pattern the row wants, one letter per photograph in
     manifest order. `cols` are the columns it splits into and `take` is how
     many photographs stack in each. Exactly one column carries either `ar`,
     which anchors the row's height while the rest stretch to it, or `nat`,
     which keeps that photograph's own ratio instead of cropping it.

     Every template fills the width of the grid, whether it holds one
     photograph or three, so the right-hand edge of the page runs straight the
     whole way down. Don't add one that doesn't. */
  var TEMPLATES = {
    // A photograph alone, uncropped, the full width of the grid. A panorama
    // has nowhere else to go, so the packer reaches for W on its own; L is the
    // biggest a single frame can be shown here and is never chosen
    // automatically — giving one photograph a whole row is an editorial call,
    // so it only happens when a plan asks for it.
    W:    { need: "W",   cols: [{ w: 100, nat: true, take: 1 }] },
    L:    { need: "L",   cols: [{ w: 100, nat: true, take: 1 }] },

    // Two panoramas stacked beside one upright. At 66/34 the stacked pair
    // lands at about 2.66 — which is what an xPan frame already is — so the
    // row holds three photographs and crops none of them.
    WWP:  { need: "WWP", cols: [{ w: 66, take: 2 }, { w: 34, ar: 0.667, take: 1 }] },
    PWW:  { need: "PWW", cols: [{ w: 34, ar: 0.667, take: 1 }, { w: 66, take: 2 }] },

    // 0.74 sits between the two upright shapes in the collection: a 2:3 frame
    // keeps 90% of itself and a 3:4 keeps 99%.
    PP:   { need: "PP",  cols: [{ w: 50, ar: 0.74, take: 1 }, { w: 50, take: 1 }] },
    PPP:  { need: "PPP", cols: [{ w: 34, ar: 0.72, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },
    LP:   { need: "LP",  cols: [{ w: 66, take: 1 }, { w: 34, ar: 0.74, take: 1 }] },
    PL:   { need: "PL",  cols: [{ w: 34, ar: 0.74, take: 1 }, { w: 66, take: 1 }] },

    // LLe splits evenly and keeps both frames whole; LL is the unequal pair,
    // which crops the second one and is only worth it for variety.
    LLe:  { need: "LL",  cols: [{ w: 50, ar: 1.50, take: 1 }, { w: 50, take: 1 }] },
    LL:   { need: "LL",  cols: [{ w: 56, ar: 1.62, take: 1 }, { w: 44, take: 1 }] },

    // 68/32 rather than 62/38: it leaves the hero its own 3:2 and still lands
    // the two stacked beside it at about 1.45, instead of squeezing them to 1.8.
    LLL:  { need: "LLL", cols: [{ w: 68, ar: 1.50, take: 1 }, { w: 32, take: 2 }] },
    LLLr: { need: "LLL", cols: [{ w: 32, take: 2 }, { w: 68, ar: 1.50, take: 1 }] },
    LLL3: { need: "LLL", cols: [{ w: 34, ar: 1.42, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },
    LLL4: { need: "LLL", cols: [{ w: 34, ar: 1.33, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },

    // 52/48, again so the pair stacked beside the upright keeps a landscape
    // shape rather than being cropped into strips.
    PLL:  { need: "PLL", cols: [{ w: 52, ar: 0.74, take: 1 }, { w: 48, take: 2 }] },
    LLP:  { need: "LLP", cols: [{ w: 48, take: 2 }, { w: 52, ar: 0.74, take: 1 }] },

    // A collection's one great upright, as big as the grid allows: 64% wide
    // and uncropped, with three landscapes stacked beside it at about 3:2. A
    // 4:5 frame comes out around 825px tall on a laptop, just under the bar,
    // so it is seen whole. On a phone 64% would be a thumbnail, so the row
    // folds (`.is-feature` in site.css): the upright full width, the three
    // below it. Only ever used by a plan — picking the jewel is editorial.
    PLLL: { need: "PLLL", cls: "is-feature", cols: [
            { w: 64, nat: true, take: 1, ph: 1 }, { w: 36, take: 3, ph: 1 }] },

    // Nothing cropped, for a collection shot as 4:5 uprights and 3:2
    // landscapes (Yunnan). The landscapes anchor at their own ratio and the
    // upright stretches beside them; the widths are solved so that stretch
    // lands on 4:5 at laptop size, so on a phone only the upright gives a
    // percent or two. Plan only.
    PLLn: { need: "PLL", cols: [{ w: 52, take: 1 }, { w: 48, nat: true, take: 2 }] },
    LLPn: { need: "LLP", cols: [{ w: 48, nat: true, take: 2 }, { w: 52, take: 1 }] },
    LPn:  { need: "LP",  cols: [{ w: 65.2, nat: true, take: 1 }, { w: 34.8, take: 1 }] },
    PLn:  { need: "PL",  cols: [{ w: 34.8, take: 1 }, { w: 65.2, nat: true, take: 1 }] },
    PPn:  { need: "PP",  cols: [{ w: 50, nat: true, take: 1 }, { w: 50, take: 1 }] },

    // Nothing cropped, whatever the shapes: a vertical xPan beside a 3:4
    // beside a 3:2 (Alberta, British Columbia, Yukon). The columns carry no
    // widths; each grows by its photograph's own aspect ratio, so every frame
    // keeps its ratio and the row comes out one height at any window width.
    // Plan only.
    J2:   { need: "??",  just: true, cols: [{ nat: true, take: 1 }, { nat: true, take: 1 }] },
    J3:   { need: "???", just: true, cols: [{ nat: true, take: 1 }, { nat: true, take: 1 },
                                            { nat: true, take: 1 }] },

    // Square-cropping discards the most of a photograph, so these are the last
    // arrangements tried rather than the first. "*" means either orientation.
    SS:   { need: "**",  cols: [{ w: 50, ar: 1, take: 1 }, { w: 50, take: 1 }] },
    SSS:  { need: "***", cols: [{ w: 34, ar: 1, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },

    // Four frames from one burst, read left to right like a strip of film.
    // Every cell anchors itself square, so the strip can fold into two by two
    // on a phone (`.is-seq` in site.css) and still read in order. Only ever
    // used by a plan; the packer has no way to know which frames belong
    // together.
    SSSS: { need: "****", cls: "is-seq", cols: [
            { w: 25, ar: 1, take: 1 }, { w: 25, ar: 1, take: 1 },
            { w: 25, ar: 1, take: 1 }, { w: 25, ar: 1, take: 1 }] }
  };

  // What the packer tries when a collection has no plan of its own, best first.
  // A block led by an upright wins ties: uprights are rarer than landscapes and
  // suffer most from being squeezed.
  var AUTO = [
    { name: "PLL", pri: 2 }, { name: "LLP", pri: 2 },
    { name: "WWP" }, { name: "PWW" }, { name: "W", pri: -1 },
    { name: "LLL" }, { name: "LLe" }, { name: "LLL3" }, { name: "LLLr" },
    { name: "LP" }, { name: "PL" }, { name: "PP" }, { name: "PPP" },
    { name: "SS", pri: -1 }
  ];

  function fits(tpl, photos, i) {
    if (!tpl || i + tpl.need.length > photos.length) return false;
    for (var j = 0; j < tpl.need.length; j++) {
      if (!cellFits(tpl.need.charAt(j), photos[i + j])) return false;
    }
    return true;
  }

  // Best-fitting template at this position, or null. `k` rotates the search so
  // that among equally-suited templates the same one doesn't repeat.
  function pickBlock(photos, i, k) {
    var best = null, bestScore = -Infinity;

    for (var n = 0; n < AUTO.length; n++) {
      var at = (k + n) % AUTO.length;
      var cand = TEMPLATES[AUTO[at].name];
      if (!fits(cand, photos, i)) continue;

      // Priority dominates; the rotation only breaks ties between equals.
      var score = (AUTO[at].pri || 0) * 100 - n;
      if (score > bestScore) { bestScore = score; best = { block: cand, at: at }; }
    }
    return best;
  }

  /* A collection may carry an explicit running order in data/collections.json:
     `"layout": ["PP", "LLL4", "W", ...]`, one template name per row, applied to
     the photographs in manifest order once the opener has been lifted out. That
     is how a gallery gets an arrangement that was designed rather than
     improvised.

     The plan is a suggestion, never a requirement. The moment a row asks for a
     shape the photographs no longer have — because one was added, removed or
     moved — the plan is abandoned from that row on and the packer takes over.
     So a stale plan degrades to an automatic layout instead of a broken page. */
  function composeBlocks(photos, layout) {
    var out = [], i = 0, k = 0, guard = 0;

    for (var n = 0; layout && n < layout.length; n++) {
      var planned = TEMPLATES[layout[n]];
      if (!fits(planned, photos, i)) break;
      out.push({ block: planned, from: i });
      i += planned.need.length;
    }

    while (i < photos.length && guard++ < 500) {
      var hit = pickBlock(photos, i, k);
      if (hit) {
        out.push({ block: hit.block, from: i });
        i += hit.block.need.length;
        k = (hit.at + 1) % AUTO.length;
      } else {
        out.push({ block: null, from: i });        // runs alone, uncropped
        i += 1;
      }
    }
    return out;
  }

  // One thumbnail. `index` is its position in the collection, so the lightbox
  // arrows keep walking the collection's own order.
  function makeTile(photo, index, total, sizes) {
    var tile = el("button", "tile");
    tile.type = "button";
    tile.setAttribute("aria-label", CAPTIONS.grid.title && photo.title
      ? tr("View {title} larger", { title: photo.title })
      : tr("View photograph {n} of {total} larger", { n: index + 1, total: total }));

    var img = el("img");
    responsive(img, photo, sizes || tileSizes(1), photo.thumb || photo.src);
    // A cell that crops trims evenly from both ends unless the photograph
    // says otherwise: `"focus": "center bottom"` in photos.json keeps a long
    // tail that would otherwise lose its tip.
    if (photo.focus) img.style.objectPosition = photo.focus;
    img.alt = altFor(photo);
    img.loading = index < 8 ? "eager" : "lazy";
    img.decoding = "async";
    img.dataset.loaded = "false";

    var reveal = function () { img.dataset.loaded = "true"; };
    if (img.complete) reveal();
    else {
      img.addEventListener("load", reveal, { once: true });
      img.addEventListener("error", reveal, { once: true });
    }
    tile.appendChild(img);

    var showTitle = CAPTIONS.grid.title && photo.title;
    var showPlace = CAPTIONS.grid.location && photo.location;
    if (showTitle || showPlace) {
      var label = el("span", "tile-label");
      if (showTitle) {
        var t = el("span", "tile-title");
        t.textContent = photo.title;
        label.appendChild(t);
      }
      if (showPlace) {
        var place = el("span", "tile-place");
        place.textContent = photo.location;
        label.appendChild(place);
      }
      tile.appendChild(label);
    }

    tile.addEventListener("click", function () { open(index); });
    return tile;
  }

  // The opener: whichever photograph is flagged `featured`, else the first.
  // A landscape spans the window and is trimmed to its height; an upright or
  // a square (California in Film's 6×6 frames; Newton: "just leave it
  // square") is never cropped. See .book-opener in site.css.
  function renderOpener(photos) {
    var slot = document.querySelector(".book-opener");
    if (!slot) return 0;

    var at = 0;
    for (var n = 0; n < photos.length; n++) { if (photos[n].featured) { at = n; break; } }
    var photo = photos[at];

    var upright = aspectOf(photo) <= 1.05;          // squares count as uprights here
    var img = el("img");
    // A landscape opener is always the window's width (trimmed to its height,
    // never shrunk), so it asks for 100vw. An upright is capped at
    // --opener-h-upright, repeated here rather than read from the stylesheet
    // because a custom property holding a length comes back as text.
    responsive(img, photo, upright ? cappedSizes(photo, 88) : "100vw");
    // Where the trim falls when the window is wider than the photograph.
    if (photo.focus) img.style.objectPosition = photo.focus;
    img.alt = altFor(photo);
    img.decoding = "async";

    slot.textContent = "";
    slot.classList.toggle("is-upright", upright);
    slot.appendChild(img);
    slot.addEventListener("click", function () { open(at); });
    return at;
  }

  function renderGrid(photos, layout) {
    var grid = document.getElementById("grid");
    var lead = document.querySelector(".book-lead");

    if (!photos.length) {
      // An empty collection has no opener either — otherwise the page starts
      // with a tall band of nothing above the message.
      if (lead) lead.hidden = true;
      status(grid, tr("Photographs from this trip haven't been added yet."));
      return;
    }
    if (lead) lead.hidden = false;

    var openerAt = renderOpener(photos);
    var rest = [];
    photos.forEach(function (p, i) { if (i !== openerAt) rest.push({ photo: p, at: i }); });

    grid.textContent = "";
    var frag = document.createDocumentFragment();

    composeBlocks(rest.map(function (r) { return r.photo; }), layout)
      .forEach(function (step) {
      var row = el("div", "book-row");
      var cursor = step.from;

      if (!step.block) {
        var lone = rest[cursor];
        var upright = famOf(lone.photo) === "P";
        var col = el("div", "book-col");
        col.style.flex = "0 0 " + (upright ? 34 : 100) + "%";
        var soloShare = upright ? 0.34 : 1;                        // the flex above
        var soloTile = makeTile(lone.photo, lone.at, photos.length,
                                tileSizes(soloShare));
        soloTile.classList.add("is-natural");
        soloTile.style.setProperty("--cell-ar", aspectOf(lone.photo).toFixed(4));
        col.appendChild(soloTile);
        if (upright) row.className = "book-row is-solo";
        row.appendChild(col);
        frag.appendChild(row);      // must go in the fragment like every other
        return;                     // row, or it jumps ahead of all of them
      }

      if (step.block.cls) row.classList.add(step.block.cls);
      // A justified row shares its width out by aspect ratio (see J2).
      var arSum = 0;
      if (step.block.just) {
        for (var j = 0; j < step.block.need.length; j++) arSum += aspectOf(rest[step.from + j].photo);
      }
      step.block.cols.forEach(function (spec) {
        var col = el("div", "book-col");
        var w = step.block.just ? aspectOf(rest[cursor].photo) / arSum * 100 : spec.w;
        // Grow from a zero basis rather than a percentage: the gaps come out
        // of the free space first, so the columns still add up to exactly the
        // row's width. Percentages summing to 100 plus a gap overflow it.
        col.style.flex = w + " 1 0";
        for (var n = 0; n < spec.take; n++) {
          var item = rest[cursor++];
          var tile = makeTile(item.photo, item.at, photos.length,
                              tileSizes(w / 100, spec.ph));
          if (spec.nat) {
            tile.classList.add("is-natural");
            tile.style.setProperty("--cell-ar", aspectOf(item.photo).toFixed(4));
          } else if (spec.ar) {
            tile.classList.add("is-anchor");
            tile.style.setProperty("--cell-ar", String(spec.ar));
          }
          col.appendChild(tile);
        }
        row.appendChild(col);
      });

      frag.appendChild(row);
    });

    grid.appendChild(frag);
  }

  function show(i) {
    if (!shown.length) return;
    index = (i + shown.length) % shown.length;       // wrap at both ends

    var photo = shown[index];
    // .lb-image is capped at roughly 80vh once the caption is allowed for.
    lbImage.removeAttribute("srcset");        // or the old one races the new
    responsive(lbImage, photo, cappedSizes(photo, 80));
    lbImage.alt = photo.alt || altFor(photo);
    lbTitle.textContent = (CAPTIONS.lightbox.title && photo.title) || "";
    lbMeta.textContent = metaLine(photo);
    lbExif.textContent = exifLine(photo);
    if (lbName) nameLine(photo);

    // One photograph alone (a journal entry's, NLSite.viewer): no arrows.
    lightbox.classList.toggle("is-single", shown.length < 2);

    // With every caption off there is no text block, so let the photograph
    // use the height the caption would have taken.
    lightbox.classList.toggle("is-bare",
      !lbTitle.textContent && !lbMeta.textContent && !lbExif.textContent &&
      !(lbName && lbName.textContent));

    // Warm the neighbours so arrowing through feels instant.
    [index + 1, index - 1].forEach(function (n) {
      var next = shown[(n + shown.length) % shown.length];
      // Warm the same file the lightbox will actually ask for — preloading
      // the 4000px original when it will display the 2400px one downloads
      // both.
      if (next) responsive(new Image(), next, cappedSizes(next, 80));
    });
  }

  function open(i) {
    show(i);
    if (isOpen) return;
    isOpen = true;
    lightbox.hidden = false;
    body.classList.add("lb-open");
    lightbox.querySelector(".lb-close").focus();
    // Lets the phone's Back gesture close the viewer rather than leave the page.
    try { history.pushState({ lb: true }, ""); } catch (e) { /* file:// */ }
  }

  function close(fromPopstate) {
    if (!isOpen) return;
    isOpen = false;
    lightbox.hidden = true;
    lbImage.removeAttribute("src");
    body.classList.remove("lb-open");
    if (!fromPopstate && history.state && history.state.lb) {
      try { history.back(); } catch (e) { /* no-op */ }
    }
    if (lbReturn) {
      var back = lbReturn;
      lbReturn = null;
      try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ }
    }
  }

  // The same viewer for another page's photographs (the travel journal,
  // assets/journal.js): `list` is what the arrows walk, photos.json records
  // or { src, alt } for a file of the page's own, and `i` the one to open
  // first. Keys, swipe, the Back gesture and the caption lines are the
  // gallery's. Focus goes back to `from` (or whatever had it) on close.
  function viewer(list, i, from) {
    if (!lightbox) wireLightbox();
    if (!lightbox || !list || !list.length) return;
    shown = list;
    lbReturn = from || document.activeElement;
    open(Math.max(0, Math.min(list.length - 1, i || 0)));
  }

  function wireLightbox() {
    lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    lbImage = lightbox.querySelector(".lb-image");
    lbTitle = lightbox.querySelector(".lb-title");
    lbMeta  = lightbox.querySelector(".lb-meta");
    lbExif  = lightbox.querySelector(".lb-exif");
    lbName  = lightbox.querySelector(".lb-name");

    lightbox.querySelector(".lb-close").addEventListener("click", function () { close(false); });
    lightbox.querySelector(".lb-prev").addEventListener("click", function () { show(index - 1); });
    lightbox.querySelector(".lb-next").addEventListener("click", function () { show(index + 1); });

    // Backdrop closes; the photograph and caption don't.
    lightbox.addEventListener("click", function (ev) {
      if (ev.target === lightbox || ev.target.classList.contains("lb-figure")) close(false);
    });

    window.addEventListener("popstate", function () { close(true); });

    document.addEventListener("keydown", function (ev) {
      if (!isOpen) return;
      if (ev.key === "Escape") close(false);
      else if (ev.key === "ArrowRight" && shown.length > 1) show(index + 1);
      else if (ev.key === "ArrowLeft" && shown.length > 1) show(index - 1);
      else return;
      ev.preventDefault();
    });

    var startX = null, startY = null;
    lightbox.addEventListener("touchstart", function (ev) {
      startX = ev.changedTouches[0].clientX;
      startY = ev.changedTouches[0].clientY;
    }, { passive: true });

    lightbox.addEventListener("touchend", function (ev) {
      if (startX === null) return;
      var dx = ev.changedTouches[0].clientX - startX;
      var dy = ev.changedTouches[0].clientY - startY;
      // Horizontal intent only, and far enough not to be a stray tap.
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) && shown.length > 1) show(dx < 0 ? index + 1 : index - 1);
      startX = startY = null;
    }, { passive: true });
  }

  // A blurb is plain text, its blank lines the paragraph breaks, and a link
  // written in it as [words](address) (Newton's links in the Catalina in
  // Film essay, 2026-10-16). An address on this site is written from the
  // site's root (collections/desert-west/) and found from this page; only
  // web and mail addresses link. ?edit seeds the slot with the raw text
  // (edit.js), so a link survives an edit there.
  function blurbText(el, text) {
    var LINK = /\[([^\]\n]+)\]\(([^()\s]+)\)/g, at = 0, m;
    var base = document.body.getAttribute("data-base") || "";
    el.textContent = "";
    while ((m = LINK.exec(text))) {
      var href = m[2];
      if (!/^(https?:|mailto:)/i.test(href)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;   // javascript: and the like stay text
        if (href.charAt(0) !== "#" && href.charAt(0) !== "/") href = base + href;
      }
      el.appendChild(document.createTextNode(text.slice(at, m.index)));
      var a = document.createElement("a");
      a.href = href;
      a.textContent = m[1];
      if (/^https?:/i.test(href)) a.rel = "noopener";
      el.appendChild(a);
      at = m.index + m[0].length;
    }
    el.appendChild(document.createTextNode(text.slice(at)));
  }

  function renderGallery(collections, photos) {
    var slug = body.dataset.collection;
    var meta = collections.filter(function (c) { return c.slug === slug; })[0] || {};
    collectionName = meta.title || "";           // used for alt text

    var titleEl = document.querySelector(".gallery-title");
    var dateEl  = document.querySelector(".gallery-date");
    var subEl   = document.querySelector(".gallery-sub");
    var blurbEl = document.querySelector(".gallery-blurb");

    if (titleEl && meta.title) {
      titleEl.textContent = placeName(meta.title);
      document.title = tr("{title} — Newton Liu Photography", { title: placeName(meta.title) });
    }
    if (subEl)   subEl.textContent   = meta.subtitle || "";
    // A title, subtitle or blurb in Chinese marks itself (chineseText, above).
    if (blurbEl) blurbText(blurbEl, meta.blurb || "");

    shown = photos.filter(function (p) { return p.collection === slug; });

    // A collection's own "date" overrides the one derived from capture dates;
    // an empty one ("date": "") hides the line altogether.
    if (dateEl) dateEl.textContent =
      dateText(typeof meta.date === "string" ? meta.date : collectionDate(shown));

    // "opener": "whole" shows the opening photograph entire, below the bar,
    // rather than trimmed to the window. See .book-lead.is-whole in site.css.
    var lead = document.querySelector(".book-lead");
    if (lead) lead.classList.toggle("is-whole", meta.opener === "whole");
    if (meta.journal) journalLink(slug, meta.journal);
    renderGrid(shown, meta.layout);
    wireLightbox();
  }

  // A trip with a travel journal ("journal": "journals/quebec/" on its
  // collections.json entry) links to it from the rail: "Journal →". While
  // the journal is a draft (data/places.json, places.<slug>.journal.draft)
  // the link shows in the local preview only, as on the globe's card.
  function journalLink(slug, href) {
    var rail = document.querySelector(".book-rail");
    if (!rail || rail.querySelector(".gallery-journal") || !/^journals\/[a-z0-9-]+\/$/.test(href)) return;
    function add() {
      var p = el("p", "gallery-journal");
      var a = p.appendChild(el("a", "text-link"));
      a.href = BASE + href;
      a.textContent = tr("Journal →");
      var blurb = rail.querySelector(".gallery-blurb");   // under the date, above his words
      rail.insertBefore(p, blurb && blurb.parentNode === rail ? blurb : null);
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return add();
    getJSON("data/places.json").then(function (data) {
      var j = data && data.places && data.places[slug] && data.places[slug].journal;
      if (j && j.draft === false) add();
    }).catch(function () { /* no link, no harm */ });
  }

  /* ---------- boot ------------------------------------------------------ */

  var target = document.getElementById("collection-grid") || document.getElementById("grid");
  if (!target) return;

  Promise.all([getJSON("data/collections.json"), getJSON("data/photos.json")])
    .then(function (results) {
      var collections = (results[0] && results[0].collections) || [];
      var photos = (results[1] && results[1].photos) || [];
      if (PAGE === "gallery") renderGallery(collections, photos);
      else renderHome(collections, photos);
    })
    .catch(function (err) {
      // Nearly always this: opened as a file:// URL, where fetch is blocked.
      status(target, location.protocol === "file:"
        ? "Open this site through a local server, not by double-clicking the file — run: python3 -m http.server 8000"
        : tr("Couldn't load the site data. {err}", { err: err.message }));
    });
})();
