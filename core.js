// Ядро калькулятора: разбор выражений (без eval), расчёт строк со ссылками, форматирование, правила ввода.
// Работает и в браузере (window.CalcCore), и в node (module.exports) — так его проверяют тесты.
//
// Выражение строки хранится как массив «атомов»:
//   цифры '0'..'9' и '.'                 — из подряд идущих складываются числа
//   '+', '-', '×', '÷', '^'              — действия
//   '(' , ')'                            — скобки
//   '%', '²', '³', '!'                   — действия после числа
//   '√', '∛', 'ln', 'log', 'lg2', 'abs'  — функции перед числом
//   'rnd', 'rup', 'rdn'                  — округление (до ближайшего, вверх, вниз) с шагом: окр(x; 0,5)
//   ';'                                  — разделитель аргументов функции
//   'π', 'e'                             — константы
//   {r: id}                              — ссылка на результат строки с номером id
// Результаты не хранятся: они всегда пересчитываются из выражений.
(function (root) {
  'use strict';

  const DIG = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  const BIN = new Set(['+', '-', '×', '÷', '^']);
  const POST = new Set(['%', '²', '³', '!']);
  const FN = new Set(['√', '∛', 'ln', 'log', 'lg2', 'abs', 'rnd', 'rup', 'rdn']);
  const FN_PAREN = new Set(['ln', 'log', 'lg2', 'abs', 'rnd', 'rup', 'rdn']); // вставляются вместе с «(»
  const FN_ARGS = new Set(['rnd', 'rup', 'rdn']); // второй аргумент после «;» — шаг округления
  const FN_NAME = {lg2: 'log₂', rnd: 'окр', rup: 'вверх', rdn: 'вниз'};
  const CONST = new Set(['π', 'e']);
  const SIG = 14; // значащих цифр в результате: убирает хвосты вида 0.30000000000000004

  const isRef = a => a !== null && typeof a === 'object';
  const isNumCh = a => typeof a === 'string' && (DIG.has(a) || a === '.');
  const endsOperand = a => a !== undefined && (isRef(a) || isNumCh(a) || a === ')' || POST.has(a) || CONST.has(a));

  class CalcError extends Error { constructor(msg, code) { super(msg); this.code = code || 'err'; } }

  /* ---------- разбор ---------- */
  function tokenize(atoms) {
    const out = [];
    for (let i = 0; i < atoms.length;) {
      const a = atoms[i];
      if (isNumCh(a)) {
        let j = i, s = '';
        while (j < atoms.length && isNumCh(atoms[j])) s += atoms[j++];
        if ((s.match(/\./g) || []).length > 1) throw new CalcError('Две запятые в числе');
        if (s === '.') throw new CalcError('Нет числа');
        out.push({k: 'num', v: parseFloat(s.startsWith('.') ? '0' + s : s)});
        i = j; continue;
      }
      if (isRef(a)) out.push({k: 'ref', id: a.r});
      else if (BIN.has(a)) out.push({k: 'op', v: a});
      else if (a === '(' || a === ')' || a === ';') out.push({k: a});
      else if (POST.has(a)) out.push({k: 'post', v: a});
      else if (FN.has(a)) out.push({k: 'fn', v: a});
      else if (CONST.has(a)) out.push({k: 'const', v: a});
      else throw new CalcError('Неизвестный символ');
      i++;
    }
    return out;
  }

  function parse(atoms) {
    const t = tokenize(atoms);
    let p = 0;
    const peek = () => t[p];
    const isOp = (v) => t[p] && t[p].k === 'op' && t[p].v === v;

    function expr() {
      let l = term();
      while (isOp('+') || isOp('-')) {
        const op = t[p++].v;
        const r = term();
        // правило процентов: a + b% = a·(1 + b/100), a − b% = a·(1 − b/100)
        l = r.t === 'pct' ? {t: 'addpct', op, l, r: r.x} : {t: 'bin', op, l, r};
      }
      return l;
    }
    function term() {
      let l = unary();
      while (isOp('×') || isOp('÷')) { const op = t[p++].v; l = {t: 'bin', op, l, r: unary()}; }
      return l;
    }
    function unary() {
      if (isOp('-')) { p++; return {t: 'neg', x: unary()}; }
      if (isOp('+')) { p++; return unary(); }
      return power();
    }
    function power() {
      const b = postfix();
      if (isOp('^')) { p++; return {t: 'bin', op: '^', l: b, r: unary()}; }
      return b;
    }
    function postfix() {
      let x = primary();
      while (peek() && peek().k === 'post') {
        const v = t[p++].v;
        x = v === '%' ? {t: 'pct', x} : {t: 'post', v, x};
      }
      return x;
    }
    function primary() {
      const k = peek();
      if (!k) throw new CalcError('Не хватает числа', 'incomplete');
      if (k.k === 'num') { p++; return {t: 'num', v: k.v}; }
      if (k.k === 'const') { p++; return {t: 'num', v: k.v === 'π' ? Math.PI : Math.E}; }
      if (k.k === 'ref') { p++; return {t: 'ref', id: k.id}; }
      if (k.k === '(') {
        p++;
        const e = expr();
        if (peek() && peek().k === ')') p++;
        else if (peek() && peek().k === ';') throw new CalcError('«;» — только внутри окр(…), вверх(…), вниз(…)');
        else if (peek()) throw new CalcError('Нет действия между числами');
        // незакрытая скобка в конце строки закрывается сама
        return e;
      }
      if (k.k === 'fn' && FN_ARGS.has(k.v) && t[p + 1] && t[p + 1].k === '(') {
        p += 2;
        const x = expr();
        let y = null;
        if (peek() && peek().k === ';') { p++; y = expr(); }
        if (peek() && peek().k === ')') p++;
        else if (peek()) throw new CalcError(peek().k === ';' ? 'Лишняя «;»' : 'Нет действия между числами');
        return {t: 'fn', v: k.v, x, y};
      }
      if (k.k === 'fn') {
        p++;
        let x;
        if (isOp('-')) { p++; x = {t: 'neg', x: postfix()}; } else x = postfix();
        return {t: 'fn', v: k.v, x};
      }
      if (k.k === ')') throw new CalcError('Лишняя скобка');
      if (k.k === ';') throw new CalcError('«;» — только внутри окр(…), вверх(…), вниз(…)');
      if (k.k === 'post') throw new CalcError('Нет числа перед ' + k.v);
      throw new CalcError('Не хватает числа', 'incomplete');
    }

    if (!t.length) return null;
    const e = expr();
    if (p < t.length) {
      const k = t[p];
      if (k.k === ')') throw new CalcError('Лишняя скобка');
      if (k.k === ';') throw new CalcError('«;» — только внутри окр(…), вверх(…), вниз(…)');
      throw new CalcError('Нет действия между числами');
    }
    return e;
  }

  function fact(n) {
    if (n < 0 || !Number.isInteger(n)) throw new CalcError('x! — только для целых ≥ 0');
    if (n > 170) throw new CalcError('Слишком большое число');
    let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
  }

  function evalNode(n, getRef) {
    const ev = x => evalNode(x, getRef);
    let v;
    switch (n.t) {
      case 'num': return n.v;
      case 'ref': return getRef(n.id);
      case 'neg': return -ev(n.x);
      case 'pct': return ev(n.x) / 100;
      case 'addpct': { const a = ev(n.l), b = ev(n.r); v = n.op === '+' ? a * (1 + b / 100) : a * (1 - b / 100); break; }
      case 'post': { const a = ev(n.x); v = n.v === '²' ? a * a : n.v === '³' ? a * a * a : fact(a); break; }
      case 'bin': {
        const a = ev(n.l), b = ev(n.r);
        if (n.op === '+') v = a + b;
        else if (n.op === '-') v = a - b;
        else if (n.op === '×') v = a * b;
        else if (n.op === '÷') { if (b === 0) throw new CalcError('Деление на ноль'); v = a / b; }
        else v = Math.pow(a, b);
        break;
      }
      case 'fn': {
        const a = ev(n.x);
        if (FN_ARGS.has(n.v)) {
          const step = n.y ? ev(n.y) : 1;
          if (!(step > 0)) throw new CalcError('Шаг округления должен быть больше 0');
          const q = +(a / step).toPrecision(12); // 2,675 ÷ 0,01 = 267,4999… → 267,5
          const k = n.v === 'rup' ? Math.ceil(q) : n.v === 'rdn' ? Math.floor(q) : Math.sign(q) * Math.round(Math.abs(q));
          v = k * step;
          break;
        }
        if (n.v === '√') { if (a < 0) throw new CalcError('Корень из отрицательного числа'); v = Math.sqrt(a); }
        else if (n.v === '∛') v = Math.cbrt(a);
        else if (n.v === 'abs') v = Math.abs(a);
        else {
          if (a <= 0) throw new CalcError('Логарифм числа ≤ 0');
          v = n.v === 'ln' ? Math.log(a) : n.v === 'log' ? Math.log10(a) : Math.log2(a);
        }
        break;
      }
    }
    if (Number.isNaN(v)) throw new CalcError('Не определено');
    if (!Number.isFinite(v)) throw new CalcError('Слишком большое число');
    return v;
  }

  function round(v) { if (v === 0) return 0; const r = +v.toPrecision(SIG); return r === 0 ? 0 : r; }

  // Расчёт одного выражения. Возвращает {v} или {err}, или null для пустой строки.
  function evaluate(atoms, getRef) {
    try {
      const ast = parse(atoms);
      if (!ast) return null;
      return {v: round(evalNode(ast, getRef || (() => { throw new CalcError('Нет связанной строки'); })))};
    } catch (e) {
      if (e instanceof CalcError) return {err: e.message, code: e.code};
      throw e;
    }
  }

  /* ---------- строки со ссылками ---------- */
  // lines — массив {id, expr, del}. Возвращает Map id → {v}|{err}|null.
  function computeAll(lines) {
    const byId = new Map(lines.filter(l => !l.del).map(l => [l.id, l]));
    const res = new Map();
    const stack = new Set();
    function calc(id) {
      if (res.has(id)) return res.get(id);
      const l = byId.get(id);
      if (!l) return {err: 'Строка удалена', code: 'gone'};
      if (stack.has(id)) return {err: 'Цикл ссылок', code: 'cycle'};
      stack.add(id);
      const r = evaluate(l.expr, rid => {
        const x = calc(rid);
        if (!x) throw new CalcError('Ссылка на пустую строку');
        if (x.code === 'cycle') throw new CalcError('Цикл ссылок', 'cycle');
        if (x.err) throw new CalcError(x.code === 'gone' ? 'Связанная строка удалена' : 'Ошибка в связанной строке', 'dep');
        return x.v;
      });
      stack.delete(id);
      res.set(id, r);
      return r;
    }
    for (const id of byId.keys()) calc(id);
    return res;
  }

  const refsOf = expr => expr.filter(isRef).map(a => a.r);

  // Зависит ли строка a (прямо или через цепочку) от строки b. Нужна, чтобы не дать создать цикл.
  function dependsOn(lines, a, b) {
    if (a === b) return true;
    const byId = new Map(lines.filter(l => !l.del).map(l => [l.id, l]));
    const seen = new Set();
    const st = [a];
    while (st.length) {
      const id = st.pop();
      if (seen.has(id)) continue; seen.add(id);
      const l = byId.get(id); if (!l) continue;
      for (const r of refsOf(l.expr)) { if (r === b) return true; st.push(r); }
    }
    return false;
  }

  // Строки, которые напрямую ссылаются на id
  const directDependents = (lines, id) => lines.filter(l => !l.del && l.expr.some(a => isRef(a) && a.r === id));

  // Число в обычной записи без «e»: 1e-7 → "0.0000001"
  function plain(v) {
    let s = String(v);
    if (!/e/i.test(s)) return s;
    const neg = s[0] === '-'; if (neg) s = s.slice(1);
    let [m, ex] = s.split(/e/i); ex = +ex;
    let [ip, fp = ''] = m.split('.');
    let digits = ip + fp, point = ip.length + ex;
    if (point <= 0) s = '0.' + '0'.repeat(-point) + digits;
    else if (point >= digits.length) s = digits + '0'.repeat(point - digits.length);
    else s = digits.slice(0, point) + '.' + digits.slice(point);
    return (neg ? '-' : '') + s;
  }

  // Атомы для подстановки числа вместо ссылки (отрицательное — в скобках)
  function numberAtoms(v) {
    const s = plain(v);
    if (s[0] === '-') return ['(', '-', ...s.slice(1).split(''), ')'];
    return s.split('');
  }
  // Заменить ссылки на строку id её значением (при удалении строки)
  function freezeRef(expr, id, v) {
    const out = [];
    for (const a of expr) {
      if (isRef(a) && a.r === id) out.push(...(v === undefined ? [] : numberAtoms(v)));
      else out.push(a);
    }
    return out;
  }

  /* ---------- подбор значения ---------- */
  // Найти x, при котором f(x) = target. f может бросать исключение (ошибка в расчёте).
  // Сначала метод секущих от x0, если не сошлось — поиск смены знака и деление пополам.
  function solve(f, target, x0) {
    const g = x => { try { const v = f(x); return Number.isFinite(v) ? v - target : NaN; } catch (e) { return NaN; } };
    const tol = 1e-11 * Math.max(1, Math.abs(target));
    const done = x => ({x: +x.toPrecision(12)});
    if (Math.abs(g(x0)) <= tol) return done(x0);
    let a = x0, b = x0 === 0 ? 1 : x0 * 1.01 + 1e-9, ga = g(a), gb = g(b);
    for (let i = 0; i < 80 && Number.isFinite(ga) && Number.isFinite(gb); i++) {
      if (Math.abs(gb) <= tol) return done(b);
      if (gb === ga) break;
      const x = b - gb * (b - a) / (gb - ga);
      if (!Number.isFinite(x)) break;
      a = b; ga = gb; b = x; gb = g(b);
    }
    if (Number.isFinite(gb) && Math.abs(gb) <= tol) return done(b);
    // поиск отрезка со сменой знака вокруг x0
    const g0 = g(x0), base = Math.abs(x0) || 1;
    let lo = null, hi = null;
    for (let k = 0; k < 70 && lo === null; k++) {
      const d = base * 0.01 * Math.pow(1.6, k);
      for (const x of [x0 + d, x0 - d]) {
        const gx = g(x);
        if (Number.isFinite(gx) && Number.isFinite(g0) && Math.sign(gx) !== Math.sign(g0)) { lo = x0; hi = x; break; }
      }
    }
    if (lo === null) return null;
    let glo = g(lo);
    for (let i = 0; i < 200; i++) {
      const m = (lo + hi) / 2, gm = g(m);
      if (!Number.isFinite(gm)) return null;
      if (Math.abs(gm) <= tol || Math.abs(hi - lo) <= 1e-13 * Math.max(1, Math.abs(m))) return done(m);
      if (Math.sign(gm) === Math.sign(glo)) { lo = m; glo = gm; } else hi = m;
    }
    return null;
  }

  /* ---------- форматирование ---------- */
  const GROUP = ' '; // узкий неразрывный пробел между тысячами
  function groupInt(s, on) { return on ? s.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP) : s; }
  function roundTo(v, d) { return Number(Math.round(Number(v + 'e' + d)) + 'e-' + d); }

  // opts: {dec: знаков после запятой, sep: ',' или '.', group: true/false}
  function fmt(v, opts) {
    const o = Object.assign({dec: 4, sep: ',', group: true}, opts || {});
    if (!Number.isFinite(v)) return '';
    const a = Math.abs(v);
    if (a === 0) return '0';
    const expo = () => {
      let s = v.toExponential(Math.max(3, Math.min(o.dec + 2, 10)));
      s = s.replace(/\.?0+e/, 'e').replace('e+', 'e');
      return s.replace('.', o.sep);
    };
    if (a >= 1e15) return expo();
    let d = o.dec;
    if (a < 1) d = Math.max(d, Math.min(15, -Math.floor(Math.log10(a)) + 3)); // у малых чисел видно минимум 4 значащие цифры
    let r = roundTo(a, d);
    if (!Number.isFinite(r) || r === 0) return expo();
    let s = plain(r);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    let [ip, fp] = s.split('.');
    return (v < 0 ? '−' : '') + groupInt(ip, o.group) + (fp ? o.sep + fp : '');
  }

  // Текст для копирования: без разделителя тысяч, минус обычный
  function fmtCopy(v, opts) { return fmt(v, Object.assign({}, opts, {group: false})).replace('−', '-'); }

  /* ---------- правила ввода ---------- */
  // Состояние редактора: {atoms, cur, sel: [от, до] | null}
  function runAt(atoms, i) { // число (подряд идущие цифры), в котором стоит атом i
    if (!isNumCh(atoms[i])) return null;
    let a = i, b = i + 1;
    while (a > 0 && isNumCh(atoms[a - 1])) a--;
    while (b < atoms.length && isNumCh(atoms[b])) b++;
    return [a, b];
  }
  function runAround(atoms, cur) { // число, к которому примыкает курсор
    return runAt(atoms, cur - 1) || runAt(atoms, cur);
  }
  function openParens(atoms, upto) {
    let n = 0;
    for (let i = 0; i < upto; i++) { if (atoms[i] === '(') n++; else if (atoms[i] === ')') n--; }
    return n;
  }

  function cut(st) {
    if (!st.sel) return {atoms: st.atoms.slice(), cur: st.cur};
    const [a, b] = st.sel;
    const atoms = st.atoms.slice(); atoms.splice(a, b - a);
    return {atoms, cur: a};
  }

  // key: '0'..'9', '00', '.', '+', '-', '×', '÷', '^', '(', ')', '%', '²', '³', '!', функции, 'π', 'e', {r:id}
  function insert(st, key) {
    const replacingOp = st.sel && st.sel[1] - st.sel[0] === 1 && BIN.has(st.atoms[st.sel[0]]);
    let {atoms, cur} = cut(st);
    const put = (...xs) => { atoms.splice(cur, 0, ...xs); cur += xs.length; };
    const prev = atoms[cur - 1];
    const mulIfNeeded = () => { if (endsOperand(prev)) put('×'); };

    if (key === '00' || (typeof key === 'string' && DIG.has(key))) {
      const run = runAround(atoms, cur);
      const runStr = run ? atoms.slice(run[0], run[1]).join('') : '';
      if (!run) {
        if (isRef(prev) || prev === ')' || POST.has(prev) || CONST.has(prev)) put('×');
        if (key === '00') put('0'); else put(key);
      } else if (runStr === '0' && cur === run[1]) {
        atoms.splice(run[0], 1); cur = run[0];
        put(key === '00' ? '0' : key);
      } else if (key === '00') put('0', '0');
      else put(key);
    } else if (key === '.') {
      const run = runAround(atoms, cur);
      if (run && atoms.slice(run[0], run[1]).includes('.')) return {atoms: st.atoms, cur: st.cur, sel: st.sel};
      if (!run) { mulIfNeeded(); put('0', '.'); } else put('.');
    } else if (BIN.has(key)) {
      if (replacingOp) { put(key); return {atoms, cur, sel: null}; }
      if (prev === undefined || prev === '(') {
        if (key === '-') put('-');
      } else if (BIN.has(prev)) {
        if (key === '-' && prev !== '-' && prev !== '+') put('-'); // 5×−3
        else {
          atoms.splice(cur - 1, 1); cur--;
          if (BIN.has(atoms[cur - 1])) { atoms.splice(cur - 1, 1); cur--; } // «×−» заменяется целиком
          if (cur === 0 || atoms[cur - 1] === '(') { if (key === '-') put('-'); }
          else put(key);
        }
      } else if (FN.has(prev)) {
        if (key === '-') put('-');
      } else put(key);
    } else if (key === '(') {
      mulIfNeeded(); put('(');
    } else if (key === ';') {
      if (endsOperand(prev) && openParens(atoms, cur) > 0) put(';');
    } else if (key === ')') {
      if (endsOperand(prev) && openParens(atoms, cur) > 0) put(')');
    } else if (POST.has(key)) {
      if (endsOperand(prev) && !(key === '%' && prev === '%')) put(key);
    } else if (FN.has(key)) {
      mulIfNeeded(); if (FN_PAREN.has(key)) put(key, '('); else put(key);
    } else if (CONST.has(key) || isRef(key)) {
      mulIfNeeded(); put(key);
    }
    return {atoms, cur, sel: null};
  }

  function backspace(st) {
    if (st.sel) { const c = cut(st); return {atoms: c.atoms, cur: c.cur, sel: null}; }
    if (st.cur === 0) return st;
    const atoms = st.atoms.slice();
    let cur = st.cur;
    atoms.splice(cur - 1, 1); cur--;
    if (st.atoms[st.cur - 1] === '(' && FN_PAREN.has(atoms[cur - 1])) { atoms.splice(cur - 1, 1); cur--; }
    return {atoms, cur, sel: null};
  }
  function delForward(st) {
    if (st.sel) return backspace(st);
    if (st.cur >= st.atoms.length) return st;
    const atoms = st.atoms.slice();
    const a = atoms[st.cur];
    atoms.splice(st.cur, 1);
    if (FN_PAREN.has(a) && atoms[st.cur] === '(') atoms.splice(st.cur, 1);
    return {atoms, cur: st.cur, sel: null};
  }

  // Вставка текста (Ctrl+V): «1 234,5 × 2» → атомы
  function parseText(text) {
    let s = String(text).replace(/[\s   ]/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    s = s.replace(/,/g, '.').replace(/[−–]/g, '-').replace(/[*xх]/gi, '×').replace(/[/:]/g, '÷').replace(/pi/gi, 'π');
    const out = [];
    for (const ch of s) {
      if (DIG.has(ch) || ch === '.' || BIN.has(ch) || ch === '(' || ch === ')' || POST.has(ch) || ch === 'π' || ch === '√') out.push(ch);
      else if (ch === '=') break;
    }
    return out;
  }

  // Текст выражения для копирования
  function exprText(expr, refVal, opts) {
    const o = Object.assign({dec: 4, sep: ',', group: true}, opts || {});
    let s = '', i = 0;
    while (i < expr.length) {
      const a = expr[i];
      if (isNumCh(a)) {
        let j = i, n = '';
        while (j < expr.length && isNumCh(expr[j])) n += expr[j++];
        const [ip, fp] = n.split('.');
        s += groupInt(ip, o.group) + (fp !== undefined ? o.sep + fp : '');
        i = j; continue;
      }
      if (isRef(a)) { const v = refVal(a.r); s += v === undefined ? '?' : fmt(v, o); }
      else if (BIN.has(a)) s += ' ' + (a === '-' ? '−' : a) + ' ';
      else if (FN_NAME[a]) s += FN_NAME[a];
      else if (a === ';') s += '; ';
      else s += a;
      i++;
    }
    return s.replace(/\s+/g, ' ').trim().replace(/ /g, ' ');
  }

  const api = {CalcError, tokenize, parse, evaluate, computeAll, dependsOn, directDependents, refsOf, freezeRef,
    numberAtoms, plain, fmt, solve, FN_ARGS, FN_NAME, fmtCopy, groupInt, insert, backspace, delForward, runAt, runAround, parseText, exprText,
    endsOperand, isRef, isNumCh, BIN, POST, FN, FN_PAREN, CONST, GROUP};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
