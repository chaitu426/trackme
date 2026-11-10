import type { Answer, AskScope, PanelView, PastQuestion, Step, Turn } from "./types";

/**
 * The state of the Ask dock, as a pure reducer so its behaviour is tested without a browser. The component only drives it
 * (timers reveal an answer's steps one at a time, as a real run would stream them) and renders it.
 */
export interface AskState {
  open: boolean;
  view: PanelView;
  draft: string;
  turns: Turn[];
  history: PastQuestion[];
  scope: AskScope;
  /** Set when an answer finished while the panel was folded, so the pill can say so. */
  unseen: boolean;
}

export type AskAction =
  | { type: "open"; view?: PanelView }
  | { type: "fold" }
  | { type: "view"; view: PanelView }
  | { type: "draft"; text: string }
  | { type: "ask"; id: string; question: string; page: string; at: string; steps?: Step[] }
  | { type: "step"; id: string }
  /** A live run appends each step as the worker publishes it; the demo instead knows the whole list up front. */
  | { type: "pushStep"; id: string; step: Step }
  | { type: "answer"; id: string; answer: Answer }
  | { type: "fail"; id: string; message: string }
  | { type: "clear" }
  | { type: "scope"; scope: AskScope }
  | { type: "load"; scope?: AskScope; history?: PastQuestion[] };

export const MAX_HISTORY = 30;
export const MAX_QUESTION = 600;

export const initialState = (scope: AskScope): AskState => ({ open: false, view: "ask", draft: "", turns: [], history: [], scope, unseen: false });

export function reduce(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case "open":
      return { ...state, open: true, view: action.view ?? state.view, unseen: false };
    case "fold":
      return { ...state, open: false };
    case "view":
      return { ...state, view: action.view, open: true, unseen: false };
    case "draft":
      return { ...state, draft: action.text.slice(0, MAX_QUESTION) };
    case "ask": {
      const question = action.question.trim().slice(0, MAX_QUESTION);
      if (!question) return state;
      const turn: Turn = { id: action.id, question, status: "thinking", shownSteps: 0, ...(action.steps ? { pending: action.steps } : {}) };
      const past: PastQuestion = { id: action.id, question, at: action.at, page: action.page };
      // The same question asked again moves to the top of the history rather than appearing twice.
      const history = [past, ...state.history.filter((h) => h.question !== question)].slice(0, MAX_HISTORY);
      return { ...state, open: true, view: "ask", draft: "", turns: [...state.turns, turn], history, unseen: false };
    }
    case "step":
      return { ...state, turns: state.turns.map((t) => (t.id === action.id && t.status === "thinking" ? { ...t, shownSteps: t.shownSteps + 1 } : t)) };
    case "pushStep":
      return {
        ...state,
        turns: state.turns.map((t) =>
          t.id !== action.id || t.status !== "thinking"
            ? t
            : { ...t, pending: [...(t.pending ?? []), action.step], shownSteps: (t.pending?.length ?? 0) + 1 }
        ),
      };
    case "answer":
      return {
        ...state,
        turns: state.turns.map((t) => (t.id === action.id ? { ...t, status: "done", answer: action.answer, shownSteps: action.answer.steps.length } : t)),
        unseen: !state.open,
      };
    case "fail":
      return { ...state, turns: state.turns.map((t) => (t.id === action.id ? { ...t, status: "done", error: action.message } : t)), unseen: !state.open };
    case "clear":
      return { ...state, turns: [], draft: "" };
    case "scope":
      return { ...state, scope: action.scope };
    case "load":
      return { ...state, ...(action.scope ? { scope: action.scope } : {}), ...(action.history ? { history: action.history.slice(0, MAX_HISTORY) } : {}) };
  }
}
