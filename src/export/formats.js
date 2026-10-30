function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

export function formatClock(seconds, milliseconds = false, separator = '.') {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const base = `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)}`;
  return milliseconds ? `${base}${separator}${pad(totalMilliseconds % 1000, 3)}` : base;
}

export function groupWords(words, maximumWords, pauseSeconds) {
  const groups = [];
  let group = [];
  for (const word of words) {
    const previous = group.at(-1);
    if (group.length && (group.length >= maximumWords || word.start - previous.end > pauseSeconds)) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length) groups.push(group);
  return groups;
}

function groupText(group) {
  return group.map(({ word }) => word).join(' ');
}

export function makeTxt(words, includeTimestamps) {
  return groupWords(words, 80, 1.5)
    .map((group) => `${includeTimestamps ? `[${formatClock(group[0].start)}] ` : ''}${groupText(group)}`)
    .join('\n\n');
}

export function makeJson(transcript) {
  return JSON.stringify(transcript, null, 2);
}

export function makeSrt(words) {
  return groupWords(words, 10, 0.7).map((group, index) => (
    `${index + 1}\n${formatClock(group[0].start, true, ',')} --> ${formatClock(group.at(-1).end, true, ',')}\n${groupText(group)}`
  )).join('\n\n');
}

export function makeVtt(words) {
  const cues = groupWords(words, 10, 0.7).map((group) => (
    `${formatClock(group[0].start, true)} --> ${formatClock(group.at(-1).end, true)}\n${groupText(group)}`
  )).join('\n\n');
  return `WEBVTT\n\n${cues}`;
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function makeCsv(words) {
  return ['word,start,end', ...words.map(({ word, start, end }) => (
    [csvCell(word), start.toFixed(3), end.toFixed(3)].join(',')
  ))].join('\r\n');
}
