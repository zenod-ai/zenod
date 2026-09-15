import { expect, it } from "vitest";
import { resolveRawSourceQuote } from "../src/engine/sourceQuote.js";

it("maps only whitespace changes back to raw UTF-16 spans", () => {
  const text = "😀 Intro. Maya\r\n\t is responsible for watering\n on Thursdays. Tail.";
  const quote = "Maya is responsible for watering on Thursdays.";
  const result = resolveRawSourceQuote([{ start: 100, text }], quote, { maxRawChars: 1600 });
  expect(result).toEqual({ start: 110, end: 100 + text.indexOf(" Tail."),
    quote: "Maya\r\n\t is responsible for watering\n on Thursdays." });
  expect(text.slice(result!.start - 100, result!.end - 100)).toBe(result!.quote);
});

it.each(["No pump is approved.", "We approved 2 pumps.", "We have not approved buying a new pump!",
  "we have not approved buying a new pump.", "We have not approved...pump.",
  "We have not approved buying a new púmp.", "We have notapproved buying a new pump."])("rejects non-whitespace changes: %s", quote => {
  expect(resolveRawSourceQuote([{ start: 0, text: "We have not approved\n buying a new pump." }], quote,
    { maxRawChars: 1600 })).toBeNull();
});

it("prefers exact matches and preserves exact occurrence selection", () => {
  const text = "Keep\n this. Keep this. Keep this.";
  expect(resolveRawSourceQuote([{ start: 0, text }], "Keep this.", { maxRawChars: 100, exactOccurrence: 1 })?.start)
    .toBe(text.lastIndexOf("Keep this."));
  expect(resolveRawSourceQuote([{ start: 0, text }], "Keep this.", { maxRawChars: 100, uniqueExact: true })).toBeNull();
});

it("never uses occurrence, overlap or a raw length limit to rescue ambiguous fallback", () => {
  const runs = [{ start: 0, text: "Keep\n this. Keep\t this." }];
  for (const exactOccurrence of [0, 1, 9]) expect(resolveRawSourceQuote(runs, "Keep this.",
    { maxRawChars: 100, exactOccurrence, overlap: { start: 0, end: 1 } })).toBeNull();
});

it("does not concatenate separate authorized runs across a gap", () => {
  expect(resolveRawSourceQuote([{ start: 0, text: "Do not" }, { start: 20, text: " buy a pump." }],
    "Do not buy a pump.", { maxRawChars: 100 })).toBeNull();
});

it("checks addressed overlap and the expanded raw length", () => {
  const text = "Intro.\n Maya\n\t\t waters.";
  expect(resolveRawSourceQuote([{ start: 0, text }], "Maya waters.", { maxRawChars: 12 })).toBeNull();
  expect(resolveRawSourceQuote([{ start: 0, text }], "Maya waters.",
    { maxRawChars: 100, overlap: { start: 0, end: 5 } })).toBeNull();
  expect(resolveRawSourceQuote([{ start: 0, text }], "Maya waters.",
    { maxRawChars: 100, overlap: { start: 15, end: 20 } })?.quote).toBe("Maya\n\t\t waters.");
});

 it.each(['We discussed commodities. It remains a possibility.', 'We discussed commodities.It remains a possibility.'])('canonicalizes punctuation-adjacent spacing to exact raw: %s',raw=>{
  const quote=raw.includes('. It')?raw.replace('. It','.It'):raw.replace('.It','. It');
  expect(resolveRawSourceQuote([{start:2110,text:raw}],quote,{maxRawChars:1600})).toEqual({start:2110,end:2110+raw.length,quote:raw});
 });
 it.each([
  ['Keep a part. It matters.','Keep apart.It matters.'],
  ['The estimate is 3. 5 units.','The estimate is 3.5 units.'],
  ['Version 3. Alpha remains pending.','Version 3.Alpha remains pending.'],
  ['Keep this, please.','Keep this,please.'],
  ['Keep this. It matters.','Keep this!It matters.'],
  ['Keep this. It matters.','Keep this.it matters.'],
  ['Use 12 units. It matters.','Use 19 units.It matters.'],
 ])('retains lexical and numeric separators: %s', (text,quote)=>{
  expect(resolveRawSourceQuote([{start:0,text}],quote,{maxRawChars:1600})).toBeNull();
 });
 it('keeps punctuation-spacing fallback ambiguous across occurrences and separate runs',()=>{
  const text='Keep this.\nIt matters. Keep this.\tIt matters.';
  expect(resolveRawSourceQuote([{start:0,text}],'Keep this.It matters.',{maxRawChars:1600,exactOccurrence:0,overlap:{start:0,end:2}})).toBeNull();
  expect(resolveRawSourceQuote([{start:0,text:'Keep this.'},{start:100,text:'It matters.'}],'Keep this.It matters.',{maxRawChars:1600})).toBeNull();
 });
 it('checks canonical raw length and ownership after punctuation-space normalization',()=>{
  const text='Keep this.   It matters.';
  expect(resolveRawSourceQuote([{start:0,text}],'Keep this.It matters.',{maxRawChars:21})).toBeNull();
  expect(resolveRawSourceQuote([{start:0,text}],'Keep this.It matters.',{maxRawChars:100,overlap:{start:100,end:200}})).toBeNull();
 });
