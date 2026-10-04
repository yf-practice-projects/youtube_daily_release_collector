/**
 * YouTube の前日投稿を J-POP / ボカロの各スプレッドシートへ記録する。
 * Apps Script の「サービス」で YouTube Data API を有効化してから使用すること。
 */
const SETTINGS_PROPERTY = 'COLLECTOR_SETTINGS';
const EXCLUDED_JAPANESE_TERMS = [
  'カラオケ', '歌ってみた', '歌ってみました', 'カバー',
  '切り抜き', '切抜き', '歌枠',
];
const EXCLUDED_ENGLISH_TERMS = ['karaoke', 'playlist', 'k-pop', 'kpop', 'c-pop', 'cpop'];
const AI_GENERATION_TERMS = [
  'ai generated', 'ai music', 'ai song', 'ai cover', 'suno', 'udio',
  'ai生成', '生成ai', 'ai作曲', 'ai音楽', 'aiボーカル',
];
const CLEARLY_NON_JAPANESE_TITLE_SCRIPT = /[ก-๙가-힣А-Яа-яЁёء-ي]/;

function collectPreviousDay() {
  collectPreviousDay_(false);
}

// Run this only after changing search rules or recovering from a failed run.
function forceCollectPreviousDay() {
  collectPreviousDay_(true);
}

function collectPreviousDay_(force) {
  const settings = getSettings_();
  const interval = previousJstDay_(settings.timeZone);
  const properties = PropertiesService.getScriptProperties();
  const completionKey = 'completed:' + interval.label;
  if (!force && properties.getProperty(completionKey)) return;

  settings.configs.forEach((config) => collectForSheet_(config, interval, settings));
  properties.setProperty(completionKey, new Date().toISOString());
}

function collectForSheet_(config, interval, settings) {
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sheet = getMonthlySheet_(spreadsheet, interval.sheetName);
  const knownUrls = new Set(
    sheet.getLastRow() < 1
      ? []
      : sheet.getRange(1, 3, sheet.getLastRow(), 1).getValues()
        .flat()
        .filter((value) => typeof value === 'string' && value.startsWith('https://www.youtube.com/watch?v='))
  );

  const videos = findVideos_(config.queries, interval, settings)
    .filter((video) => !knownUrls.has(video.url));

  // A rerun does not create an empty duplicate date block.
  if (videos.length === 0) return;

  sheet.insertRowsBefore(1, videos.length + 2);
  sheet.getRange(1, 1, 1, 3).merge();
  sheet.getRange(1, 1)
    .setValue(interval.label)
    .setFontWeight('bold')
    .setBackground('#e8f0fe');
  sheet.getRange(2, 1, 1, 3)
    .setValues([['タイトル', '投稿チャンネル', 'URL']])
    .setFontWeight('bold')
    .setBackground('#f1f3f4');
  sheet.getRange(3, 1, videos.length, 3)
    .setValues(videos.map((video) => [video.title, video.channelTitle, video.url]));
  sheet.getRange(3, 3, videos.length, 1).setNumberFormat('@');
  sheet.setColumnWidth(1, 360);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 440);
}

function findVideos_(queries, interval, settings) {
  const found = new Map();

  queries.forEach((query) => {
    const response = YouTube.Search.list('snippet', {
      q: query,
      type: 'video',
      order: 'date',
      publishedAfter: interval.start,
      publishedBefore: interval.end,
      maxResults: 50,
      regionCode: 'JP',
      relevanceLanguage: 'ja',
    });

    (response.items || []).forEach((item) => {
      const id = item.id && item.id.videoId;
      const snippet = item.snippet;
      if (!id || !snippet) return;

      found.set(id, {
        id,
        title: snippet.title,
        channelTitle: snippet.channelTitle,
        channelId: snippet.channelId,
        description: snippet.description || '',
        url: `https://www.youtube.com/watch?v=${id}`,
        publishedAt: snippet.publishedAt,
      });
    });
  });

  return filterVideos_([...found.values()], settings)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

function filterVideos_(videos, settings) {
  const durations = new Map();
  const channelCountries = new Map();

  // videos.list accepts at most 50 IDs per request.
  for (let index = 0; index < videos.length; index += 50) {
    const ids = videos.slice(index, index + 50).map((video) => video.id);
    const response = YouTube.Videos.list('contentDetails', { id: ids.join(',') });
    (response.items || []).forEach((item) => {
      durations.set(item.id, isoDurationToSeconds_(item.contentDetails.duration));
    });
  }

  const channelIds = [...new Set(videos.map((video) => video.channelId).filter(Boolean))];
  for (let index = 0; index < channelIds.length; index += 50) {
    const ids = channelIds.slice(index, index + 50);
    const response = YouTube.Channels.list('snippet', { id: ids.join(',') });
    (response.items || []).forEach((item) => {
      const country = item.snippet && item.snippet.country;
      if (country) channelCountries.set(item.id, country);
    });
  }

  return videos.filter((video) => {
    const text = (video.title + ' ' + video.description).toLowerCase();
    const isTaggedShort = text.includes('#short')
      || text.includes('#youtubeshorts')
      || text.includes('#ショート');
    const isVeryShort = (durations.get(video.id) || 0) <= settings.minDurationSeconds;
    const isJapaneseCover = EXCLUDED_JAPANESE_TERMS.some((term) => text.includes(term));
    const titleWords = video.title.toLowerCase().split(/[^a-z]+/);
    const isEnglishCover = titleWords.includes('cover');
    const hasExcludedEnglishTerm = EXCLUDED_ENGLISH_TERMS.some((term) => text.includes(term));
    const isAiGenerated = AI_GENERATION_TERMS.some((term) => text.includes(term));
    const channelCountry = channelCountries.get(video.channelId);
    const isClearlyNonJapanese = channelCountry && channelCountry !== 'JP';
    const hasClearlyNonJapaneseTitleScript = CLEARLY_NON_JAPANESE_TITLE_SCRIPT.test(video.title);
    return !isTaggedShort && !isVeryShort && !isJapaneseCover
      && !isEnglishCover && !hasExcludedEnglishTerm && !isAiGenerated && !isClearlyNonJapanese
      && !hasClearlyNonJapaneseTitleScript;
  });
}

function isoDurationToSeconds_(duration) {
  const value = duration || '';
  const hours = value.match(/[0-9]+H/);
  const minutes = value.match(/[0-9]+M/);
  const seconds = value.match(/[0-9]+S/);
  return Number(hours ? hours[0].slice(0, -1) : 0) * 3600
    + Number(minutes ? minutes[0].slice(0, -1) : 0) * 60
    + Number(seconds ? seconds[0].slice(0, -1) : 0);
}

function getMonthlySheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name, 0);
}

function previousJstDay_(timeZone) {
  const now = new Date();
  const today = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');
  const yesterday = new Date(`${today}T00:00:00+09:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const nextDay = new Date(yesterday);
  nextDay.setDate(nextDay.getDate() + 1);

  return {
    start: Utilities.formatDate(yesterday, 'Etc/GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    end: Utilities.formatDate(nextDay, 'Etc/GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'"),
    label: Utilities.formatDate(yesterday, timeZone, 'yyyy年M月d日'),
    sheetName: Utilities.formatDate(yesterday, timeZone, 'yyyy年M月'),
  };
}

function getSettings_() {
  const raw = PropertiesService.getScriptProperties().getProperty(SETTINGS_PROPERTY);
  if (!raw) {
    throw new Error('スクリプト プロパティ COLLECTOR_SETTINGS を設定してください。');
  }

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (error) {
    throw new Error('COLLECTOR_SETTINGS は有効なJSONにしてください。');
  }

  if (!Array.isArray(settings.configs) || settings.configs.length === 0) {
    throw new Error('COLLECTOR_SETTINGS.configs に少なくとも1件の設定が必要です。');
  }

  settings.configs.forEach((config) => {
    if (!config.spreadsheetId || !Array.isArray(config.queries) || config.queries.length === 0) {
      throw new Error('各設定には spreadsheetId と queries が必要です。');
    }
  });

  return {
    configs: settings.configs,
    timeZone: settings.timeZone || 'Asia/Tokyo',
    minDurationSeconds: Number.isFinite(settings.minDurationSeconds)
      ? settings.minDurationSeconds
      : 180,
  };
}
