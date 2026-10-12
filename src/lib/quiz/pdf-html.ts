import { isRtl, type QuestionContent } from './types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type PdfSection = {
  title: string;
  questions: { difficulty: string; correctIndex: number; content: QuestionContent }[];
};

const LETTERS = 'ABCD';

type Labels = { questions: string; answers: string; name: string; date: string; score: string };
const mk = (questions: string, answers: string, name: string, date: string, score: string): Labels => ({ questions, answers, name, date, score });
const LABELS: Record<string, Labels> = {
  english: mk('Questions', 'Answer key', 'Name', 'Date', 'Score'),
  spanish: mk('Preguntas', 'Respuestas', 'Nombre', 'Fecha', 'Puntuación'),
  french: mk('Questions', 'Corrigé', 'Nom', 'Date', 'Note'),
  german: mk('Fragen', 'Lösungen', 'Name', 'Datum', 'Punkte'),
  italian: mk('Domande', 'Risposte', 'Nome', 'Data', 'Punteggio'),
  portuguese: mk('Perguntas', 'Respostas', 'Nome', 'Data', 'Pontuação'),
  dutch: mk('Vragen', 'Antwoorden', 'Naam', 'Datum', 'Score'),
  catalan: mk('Preguntes', 'Respostes', 'Nom', 'Data', 'Puntuació'),
  polish: mk('Pytania', 'Klucz odpowiedzi', 'Imię', 'Data', 'Wynik'),
  russian: mk('Вопросы', 'Ответы', 'Имя', 'Дата', 'Баллы'),
  turkish: mk('Sorular', 'Cevap anahtarı', 'Ad', 'Tarih', 'Puan'),
  arabic: mk('الأسئلة', 'مفتاح الإجابات', 'الاسم', 'التاريخ', 'الدرجة'),
  hindi: mk('प्रश्न', 'उत्तर कुंजी', 'नाम', 'तारीख', 'अंक'),
  chinese: mk('题目', '参考答案', '姓名', '日期', '得分'),
  japanese: mk('問題', '解答', '名前', '日付', '得点'),
  korean: mk('문제', '정답', '이름', '날짜', '점수'),
};

const CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans Arabic', sans-serif; color: #16181d; font-size: 11pt; line-height: 1.45; }
  h1 { font-size: 22pt; margin: 0 0 2mm; letter-spacing: -0.01em; }
  .sub { color: #5b6270; margin: 0 0 6mm; font-size: 10.5pt; }
  .meta { display: flex; gap: 8mm; margin: 0 0 8mm; font-size: 10pt; color: #5b6270; }
  .meta span { flex: 1; border-bottom: 1px solid #9aa1ad; padding-bottom: 1mm; }
  h2 { font-size: 13pt; margin: 8mm 0 3mm; padding: 2mm 3mm; background: #eef1f6; border-radius: 2mm; break-after: avoid; }
  .q { margin: 0 0 5mm; break-inside: avoid; }
  .q p { margin: 0 0 1.5mm; font-weight: 600; }
  .q ol { list-style: none; margin: 0; padding: 0 0 0 5mm; }
  .q li { margin: 0.8mm 0; }
  .q li b { display: inline-block; width: 6mm; color: #5b6270; }
  .ans { margin: 0 0 3.5mm; break-inside: avoid; }
  .ans .k { font-weight: 700; }
  .ans .e { color: #5b6270; font-size: 10pt; margin: 0.5mm 0 0 7mm; }
  .tag { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #8a91a0; margin-inline-start: 2mm; }
`;

/** The printable quiz: questions only (`kind` 'questions') or the answer key with explanations ('answers'). */
export function quizPdfHtml(opts: { title: string; language: string; kind: 'questions' | 'answers'; sections: PdfSection[] }): string {
  const { title, language, kind, sections } = opts;
  const L = LABELS[language.trim().toLowerCase()] ?? LABELS.english!;
  let n = 0;
  const body = sections
    .map((s) => {
      const items = s.questions
        .map((q) => {
          n++;
          const t = q.content[language];
          if (!t) return '';
          if (kind === 'questions')
            return `<div class="q"><p>${n}. ${esc(t.question)}</p><ol>${t.options.map((o, i) => `<li><b>${LETTERS[i]}.</b> ${esc(o)}</li>`).join('')}</ol></div>`;
          return `<div class="ans"><div><span class="k">${n}. ${LETTERS[q.correctIndex]}</span> — ${esc(t.options[q.correctIndex] ?? '')}<span class="tag">${esc(q.difficulty)}</span></div>${t.explanation ? `<div class="e">${esc(t.explanation)}</div>` : ''}</div>`;
        })
        .join('');
      return `<h2>${esc(s.title)}</h2>${items}`;
    })
    .join('');
  return `<!doctype html><html lang="${esc(language)}" dir="${isRtl(language) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<h1>${esc(title)}</h1>
<p class="sub">${kind === 'questions' ? L.questions : L.answers} · ${esc(language)}</p>
${kind === 'questions' ? `<div class="meta"><span>${L.name}:</span><span>${L.date}:</span><span>${L.score}: &nbsp;&nbsp;/ ${n || sections.reduce((a, s) => a + s.questions.length, 0)}</span></div>` : ''}
${body}
</body></html>`;
}
