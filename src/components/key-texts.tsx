"use client";

import type { KeyText } from "@/lib/key-texts";

export function KeyTexts({ items }: { items: KeyText[] }) {
  if (!items.length) return null;
  return <ol className="list-decimal space-y-2 pl-4">{items.map((item, index) => <li key={index}>
    {item.url ? <a href={item.url} className="underline">{item.title}</a> : item.title}
    {item.author && <span> · {item.author}</span>}{item.year && <span>（{item.year}）</span>}
  </li>)}</ol>;
}

export function KeyTextsEditor({ value, onChange }: { value: KeyText[]; onChange: (value: KeyText[]) => void }) {
  return <fieldset className="space-y-3 rounded border p-3"><legend>关键文本（可选）</legend>
    {value.map((item, index) => <div key={index} className="flex flex-wrap gap-2">
      {([['title', '作品名'], ['author', '作者'], ['year', '年份'], ['url', '作品链接']] as const).map(([field, label]) =>
        <label key={field} className="flex flex-col text-sm">{label}<input aria-label={`${label} ${index + 1}`} value={item[field] ?? ""} className="rounded border p-2" onChange={e => onChange(value.map((row, i) => i === index ? { ...row, [field]: e.target.value } : row))} /></label>)}
      <button type="button" disabled={index === 0} onClick={() => { const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}>上移</button>
      <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>移除作品 {index + 1}</button>
    </div>)}
    <button type="button" className="text-sm underline" onClick={() => onChange([...value, { title: "" }])}>添加作品</button>
  </fieldset>;
}
