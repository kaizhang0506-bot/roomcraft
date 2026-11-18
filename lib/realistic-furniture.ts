import { Box3, Color, Material, Mesh, Object3D, Vector3 } from 'three';
import type { MaterialDefinition } from './plan';

export interface FurnitureModelFit {
  scale: [number, number, number];
  offset: [number, number, number];
  sourceSize: [number, number, number];
}

/** Static glTF furniture uses Y-up, +Z front, matching the semantic editor.
 * Offset applies inside the scale group so the actual model rests on the floor. */
export function furnitureModelFit(object: Object3D, width: number, height: number, depth: number): FurnitureModelFit {
  if (![width, height, depth].every(value => Number.isFinite(value) && value > 0)) throw new Error('家具尺寸无效');
  object.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(object), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  if (![size.x, size.y, size.z].every(value => Number.isFinite(value) && value > 1e-6)) throw new Error('家具模型没有有效空间尺寸');
  return { scale: [width / size.x, height / size.y, depth / size.z], offset: [-center.x, -bounds.min.y, -center.z], sourceSize: [size.x, size.y, size.z] };
}

/** Tint upholstery only; the imported wood frame, metallic feet and texture maps stay intact. */
export function isUpholsteryMaterial(name: string): boolean {
  // Khronos SheenWoodLeatherSofa names its leather and textile parts this way.
  if (/^(Brown|Paisley|Striped|Fringe|Frame_Fabric)$/i.test(name)) return true;
  if (/wood|metal|chrome|steel|alumin|frame|leg|hardware|plastic|stitch/i.test(name)) return false;
  return /fabric|cloth|upholster|leather|suede|velvet|seat|cushion|sheen/i.test(name);
}

export function createFurnitureInstance(source: Object3D, material: MaterialDefinition): Object3D {
  const instance = source.clone(true), clones = new Map<Material, Material>();
  const originalFinish = material.id === 'linen-cream' && material.color.toLowerCase() === '#e2d7c0' && material.roughness === .95;
  const cloneMaterial = (original: Material) => {
    const cached = clones.get(original); if (cached) return cached;
    const copy = original.clone();
    if (!originalFinish && isUpholsteryMaterial(original.name)) {
      const pbr = copy as Material & { color?: Color; roughness?: number };
      pbr.color?.set(material.color);
      if (typeof pbr.roughness === 'number') pbr.roughness = Math.max(.15, Math.min(1, material.roughness));
    }
    clones.set(original, copy); return copy;
  };
  instance.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true; object.receiveShadow = true;
    object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
  });
  return instance;
}

/** Only per-instance materials are owned here. Cached glTF textures/geometry remain shared. */
export function disposeFurnitureInstance(instance: Object3D): void {
  const materials = new Set<Material>();
  instance.traverse(object => { if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); });
  materials.forEach(material => material.dispose());
}
