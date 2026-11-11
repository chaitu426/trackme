/**
 * A tiny arithmetic evaluator for the planner's `calculate` tool. Models are unreliable at arithmetic and the grounding gate
 * rejects any figure that is not in the evidence, so derived numbers (a change in percent, a share, a total) are computed
 * here, exactly, and registered as allowed figures. Only numbers, + - * / % ^, unary minus and parentheses: no names, no
 * calls, no `eval`.
 */

type Tok = { t: "num"; v: number } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const s = src.replace(/,/g, "").replace(/\s+/g, "");
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new Error("bad number");
      out.push({ t: "num", v });
      i = j;
    } else if ("+-*/%^()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`unsupported character "${c}"`);
    }
  }
  return out;
}

export function evaluate(expression: string): number {
  if (expression.length > 200) throw new Error("expression too long");
  const toks = tokenize(expression);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v !== undefined && !(t.t === "op" && t.v === v))) throw new Error("syntax error");
    p++;
    return t;
  };
  const primary = (): number => {
    const t = peek();
    if (!t) throw new Error("syntax error");
    if (t.t === "num") return (eat(), t.v);
    if (t.v === "(") {
      eat("(");
      const v = add();
      eat(")");
      return v;
    }
    if (t.v === "-") return (eat(), -unary());
    if (t.v === "+") return (eat(), unary());
    throw new Error("syntax error");
  };
  const unary = (): number => primary();
  const pow = (): number => {
    const base = unary();
    const t = peek();
    if (t?.t === "op" && t.v === "^") return (eat(), Math.pow(base, pow()));
    return base;
  };
  const mul = (): number => {
    let v = pow();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/" || t.v === "%")) {
        eat();
        const r = pow();
        if (t.v === "*") v *= r;
        else if (r === 0) throw new Error("division by zero");
        else v = t.v === "/" ? v / r : v % r;
      } else return v;
    }
  };
  const add = (): number => {
    let v = mul();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "+" || t.v === "-")) {
        eat();
        const r = mul();
        v = t.v === "+" ? v + r : v - r;
      } else return v;
    }
  };
  const result = add();
  if (p !== toks.length) throw new Error("syntax error");
  if (!Number.isFinite(result)) throw new Error("not a finite number");
  return result;
}

/** The result rounded to at most 4 decimals, as the string the model should write. */
export function formatResult(v: number): string {
  return String(Math.round(v * 1e4) / 1e4);
}
