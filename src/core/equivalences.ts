/**
 * Equivalencia entre el nombre de un producto en el cuadre y su(s) nombre(s) en el IPV.
 * Con más de un alias, las filas del IPV se suman en una sola fila del cuadre.
 */
export interface Equivalence {
  cuadre: string;
  ipv: readonly string[];
}

/**
 * Tabla de equivalencias de CLAUDE.md. Los productos que se llaman igual en ambas
 * fuentes no necesitan fila: se emparejan por nombre. Ampliarla solo con
 * confirmación de las dueñas.
 */
export const EQUIVALENCES: readonly Equivalence[] = [
  { cuadre: 'agua 1.5 l', ipv: ['agua grande'] },
  { cuadre: 'agua 500 ml', ipv: ['agua pequeña'] },
  { cuadre: 'arroz', ipv: ['arroz el rey'] },
  { cuadre: 'atun', ipv: ['atun 190g'] },
  { cuadre: 'bolsa de pan de 8 u', ipv: ['pan bolsa 8 unidades'] },
  { cuadre: 'choco paye', ipv: ['panque choco paye'] },
  { cuadre: 'cuadrito de pollo', ipv: ['cuadro de pollo'] },
  { cuadre: 'detergente kawhala', ipv: ['detergente khawla'] },
  { cuadre: 'detergente en polvo', ipv: ['detergente en polvo STB'] },
  { cuadre: 'detergente multiusos', ipv: ['detergente liquido multiuso'] },
  { cuadre: 'espaguetis', ipv: ['espagueti rosco'] },
  { cuadre: 'galletas saltiblocks', ipv: ['galletas saltiblocks paquete'] },
  { cuadre: 'unidad de galletas saltiblocks', ipv: ['galletas saltiblocks unidad'] },
  { cuadre: 'hamburguesa', ipv: ['hamburguesa de pollo'] },
  { cuadre: 'jamonada', ipv: ['jamonada lb'] },
  { cuadre: 'malta guajira chiquita', ipv: ['malta guajira 330ml'] },
  { cuadre: 'malta guajira grande', ipv: ['malta guajira grande 1.5L'] },
  { cuadre: 'mani', ipv: ['top mix peque'] },
  { cuadre: 'mayonesa cepera', ipv: ['mayonesa'] },
  { cuadre: 'panque kek', ipv: ['peter kek'] },
  { cuadre: 'paye', ipv: ['panque paye'] },
  { cuadre: 'papas mediterraneas', ipv: ['papitas verdes'] },
  { cuadre: 'papas onduladas', ipv: ['papitas rojas'] },
  { cuadre: 'papel sanitario', ipv: ['papel higienico'] },
  { cuadre: 'unidad de papel sanitario', ipv: ['papel higienico unidad'] },
  { cuadre: 'pollo', ipv: ['pollo lb'] },
  { cuadre: 'queso blanco', ipv: ['queso lb'] },
  {
    cuadre: 'refresco reenvasado',
    ipv: ['refresco cola dispensado', 'refresco naranja dispensado'],
  },
  { cuadre: 'refresco limon pomo', ipv: ['refresco limon 1.5L'] },
  { cuadre: 'sazones', ipv: ['sazon completo'] },
  { cuadre: 'sorbetos joy', ipv: ['sorbeto joy'] },
  { cuadre: 'sorbetos vitarella', ipv: ['sorbeto vitarella'] },
  { cuadre: 'marranetas', ipv: ['pellis marranetas'] },
  { cuadre: 'totox', ipv: ['pellis totox'] },
];
