// 一次性迁移：把「博客文章」文件夹里的旧 md 转成 content/posts 下的标准文章
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.dirname(import.meta.dirname); // blog/
const SRC = path.join(ROOT, '..', '博客文章');
const OUT = path.join(ROOT, 'content', 'posts');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function pad(n) { return String(n).padStart(2, '0'); }

function dateFromText(s) {
  if (!s) return null;
  let m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/(?:^|\D)(20\d{2})-(\d{1,2})-(\d{1,2})(?:\D|$)/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`;
  return null;
}

const isDateOnly = (line) => {
  const t = line.trim();
  const d = dateFromText(t);
  if (!d) return false;
  const rest = t.replace(/(?:^|\D)(?:20\d{2}[年\-/.]?\d{1,2}[月\-/.]?\d{1,2}日?|\d{8}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4})/, '').trim();
  return rest === '' || /^(夜晚|凌晨|上午|下午|傍晚|晚上|夜)$/.test(rest);
};

function cleanName(t) {
  return t
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const report = [];
  const used = new Set();
  const files = (await readdir(SRC)).filter((f) => f.toLowerCase().endsWith('.md'));

  for (const name of files) {
    const full = path.join(SRC, name);
    const raw = (await readFile(full, 'utf8')).replace(/\r\n/g, '\n');
    const lines = raw.split('\n');

    // 标题：首个 # 行；否则文件名
    let title = path.basename(name, '.md');
    let cursor = 0;
    const firstIdx = lines.findIndex((l) => l.trim() !== '');
    if (firstIdx >= 0 && /^#\s+/.test(lines[firstIdx].trim())) {
      title = lines[firstIdx].trim().replace(/^#\s+/, '').trim();
      cursor = firstIdx + 1;
    } else if (firstIdx >= 0 && cleanName(lines[firstIdx].trim()).toLowerCase() === cleanName(title).toLowerCase()) {
      cursor = firstIdx + 1; // 首行只是重复标题
    }

    // 日期：文件名 → 紧跟标题后的日期行 → 正文前 8 行
    let date = dateFromText(path.basename(name, '.md'));
    if (!date) {
      // 跳过紧跟标题的日期行
      let k = cursor;
      while (k < lines.length && lines[k].trim() === '') k++;
      if (k < lines.length && isDateOnly(lines[k])) { date = dateFromText(lines[k]); cursor = k + 1; }
    }
    if (!date) {
      for (const l of lines.slice(0, 12)) { const d = dateFromText(l); if (d && isDateOnly(l)) { date = d; break; } }
    }
    if (!date) {
      const s = await stat(full);
      date = s.mtime.toISOString().slice(0, 10);
      report.push(`${name}：文件名和正文都没有日期，用文件修改时间 ${date} 兜底`);
    }

    // 正文：去掉标题行、紧跟的日期行，压缩空行
    let body = lines.slice(cursor).join('\n');
    body = body.replace(/\n{3,}/g, '\n\n').trim();

    const slugBase = `${date}-${cleanName(title) || '未命名'}`;
    let slug = slugBase;
    let n = 2;
    while (used.has(slug)) slug = `${slugBase}-${n++}`;
    used.add(slug);

    const year = date.slice(0, 4);
    const dir = path.join(OUT, year);
    await mkdir(dir, { recursive: true });

    const front = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `date: ${date}`,
      `updated: ${date}`,
      'tags: []',
      'draft: false',
      '---',
      '',
      ''
    ].join('\n');

    await writeFile(path.join(dir, `${slug}.md`), front + body + '\n', 'utf8');
  }

  // 关于页
  await mkdir(path.join(ROOT, 'content'), { recursive: true });
  await writeFile(path.join(ROOT, 'content', 'about.md'),
`---
title: 关于我
---

喜欢写作、书法、吉他、魔方、做饭、森林、海洋等等一切可以激发灵感的东西。

喜欢计算机技术、诗词、散文、深秋的下午、冬季的黄昏，以及每个引人深思的时节。

喜欢聆听他人的故事。

痛饮狂歌空度日，东风吹梦到长安
`, 'utf8');

  console.log(`迁移完成：${files.length} 篇 → ${OUT}`);
  if (report.length) console.log('\n需要人工确认：\n' + report.join('\n'));
}

main();
