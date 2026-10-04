// Raison d'être : le formatage « à la printf » des rapports du harnais (`"%5.1f" % x` en
// GDScript). Il ne sert qu'à l'affichage — aucun nombre de la simulation ne passe par ici —
// et ne couvre que ce que le harnais utilise : %s %d %f %e, les drapeaux - + 0, la largeur et
// la précision, et %%.
export function fmt(modele: string, ...args: unknown[]): string {
  let i = 0;
  return modele.replace(/%([-+0]*)(\d+)?(?:\.(\d+))?([sdfe%])/g, (_m, drapeaux: string, largeur?: string, prec?: string, type?: string) => {
    if (type === "%") return "%";
    const v = args[i++];
    let s: string;
    switch (type) {
      case "d": s = String(Math.trunc(Number(v))); break;
      case "f": s = Number(v).toFixed(prec === undefined ? 6 : Number(prec)); break;
      case "e": s = Number(v).toExponential(prec === undefined ? 6 : Number(prec)); break;
      default: s = String(v);
    }
    if ((type === "d" || type === "f" || type === "e") && drapeaux.includes("+") && Number(v) >= 0) s = "+" + s;
    // -0.0 affiché « -0 » par toFixed n'a pas de sens dans un rapport.
    if (s === "-0" || /^-0\.0*$/.test(s)) s = s.slice(1);
    const w = largeur === undefined ? 0 : Number(largeur);
    if (s.length < w) {
      if (drapeaux.includes("-")) s = s.padEnd(w);
      else if (drapeaux.includes("0") && type !== "s") s = s.padStart(w, "0");
      else s = s.padStart(w);
    }
    return s;
  });
}

// String.num(x, n) de Godot : n décimales au plus, zéros de fin retirés.
export function num(x: number, decimales: number): string {
  return String(Number(x.toFixed(decimales)));
}
