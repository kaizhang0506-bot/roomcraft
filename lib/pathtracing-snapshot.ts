import {
  Camera, Color, EquirectangularReflectionMapping, Group, InstancedMesh, Material,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Scene, ShadowMaterial, Texture,
} from 'three';
import type {BufferGeometry} from 'three';

export interface SceneSnapshot {scene: Scene; camera: Camera; dispose: () => void}

/** Freeze editable state and adapt raster-only objects for the static path tracer. */
export function snapshotScene(scene: Scene, camera: Camera): SceneSnapshot {
  scene.updateMatrixWorld(true); camera.updateWorldMatrix(true, false);
  const snapshot = scene.clone(true), view = camera.clone();
  camera.matrixWorld.decompose(view.position, view.quaternion, view.scale); view.updateMatrixWorld(true);
  const geometries = new Map<BufferGeometry, BufferGeometry>();
  const materials = new Map<Material, Material>(), ownedMaterials = new Set<Material>();
  const textures = new Map<Texture, Texture>();
  const copyTexture = (original: Texture) => {
    let copy = textures.get(original);
    if (!copy) {copy = original.clone(); textures.set(original, copy);}
    return copy;
  };
  const copyGeometry = (original: BufferGeometry) => {
    let copy = geometries.get(original);
    if (!copy) {copy = original.clone(); geometries.set(original, copy);}
    return copy;
  };
  const copyMaterial = (original: Material): Material => {
    let copy = materials.get(original);
    if (copy) return copy;
    if (original instanceof MeshBasicMaterial) {
      // BasicMaterial has no path-traced emission. Keep sky billboards self-lit,
      // including their map alpha, instead of turning the sun/moon into dark cards.
      copy = new MeshStandardMaterial({
        color: 0x000000, emissive: original.color, emissiveMap: original.map,
        emissiveIntensity: 1, map: original.map, alphaMap: original.alphaMap,
        transparent: original.transparent, opacity: original.opacity, alphaTest: original.alphaTest,
        side: original.side, depthWrite: original.depthWrite, roughness: 1, metalness: 0,
        vertexColors: original.vertexColors, visible: original.visible,
      });
      copy.name = original.name; copy.userData = {...original.userData, snapshotBasicMaterial: true};
    } else if (original instanceof ShadowMaterial) {
      copy = new MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    } else copy = original.clone();
    const values = copy as unknown as Record<string, unknown>;
    for (const key of Object.keys(values)) {
      const value = values[key]; if (value instanceof Texture) values[key] = copyTexture(value);
    }
    materials.set(original, copy); ownedMaterials.add(copy); return copy;
  };
  const copiedMaterial = (material: Material | Material[]): Material | Material[] =>
    Array.isArray(material) ? material.map(copyMaterial) : copyMaterial(material);
  const tintMaterial = (material: Material, color: Color) => {
    const copy = material.clone(); ownedMaterials.add(copy);
    const standard = copy as MeshStandardMaterial;
    if (standard.color) standard.color.multiply(color);
    if (copy.userData.snapshotBasicMaterial && standard.emissive) standard.emissive.multiply(color);
    return copy;
  };
  // Traverse a stable list; expanding instances modifies the snapshot hierarchy.
  const objects: Object3D[] = []; snapshot.traverse(object => objects.push(object));
  for (const object of objects) {
    if (object instanceof Mesh) {
      if (object.name === 'studio-contact-shadow') { object.removeFromParent(); continue; }
      if (object.name === 'world-sky') {
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        const map = (material as MeshBasicMaterial).map;
        if (map) {
          const background = copyTexture(map); background.mapping = EquirectangularReflectionMapping;
          snapshot.background = background; snapshot.backgroundIntensity = 1;
        }
        // An enclosing sphere blocks image-based lighting even if depthWrite=false
        // in the realtime renderer. Use the gradient as distant background instead.
        object.removeFromParent(); continue;
      }
      const geometry = copyGeometry(object.geometry), material = copiedMaterial(object.material);
      if (object instanceof InstancedMesh) {
        // three-gpu-pathtracer does not consume instanceMatrix. Expand only the
        // frozen snapshot; realtime trees/buildings retain their cheap draw calls.
        const group = new Group(); group.name = object.name; group.userData = {...object.userData};
        group.matrix.copy(object.matrix); group.matrixAutoUpdate = false; group.visible = object.visible;
        const instance = new Matrix4(), tint = new Color();
        for (let index = 0; index < object.count; index++) {
          object.getMatrixAt(index, instance);
          let instanceMaterial = material;
          if (object.instanceColor) {
            object.getColorAt(index, tint);
            instanceMaterial = Array.isArray(material) ? material.map(item => tintMaterial(item, tint)) : tintMaterial(material, tint);
          }
          const mesh = new Mesh(geometry, instanceMaterial); mesh.name = `${object.name}-instance-${index}`;
          mesh.matrix.copy(instance); mesh.matrixAutoUpdate = false;
          mesh.castShadow = object.castShadow; mesh.receiveShadow = object.receiveShadow;
          group.add(mesh);
        }
        for (const child of [...object.children]) group.add(child);
        const parent = object.parent; if (parent) {parent.add(group); parent.remove(object);}
      } else {object.geometry = geometry; object.material = material;}
    } else if ((object as Object3D & {isPoints?:boolean;isLine?:boolean}).isPoints || (object as Object3D & {isLine?:boolean}).isLine) {
      // Particle stars and animated rain strokes are raster overlays, not surfaces.
      object.removeFromParent();
    }
  }
  // The path tracer derives indirect light physically; raster fog and ambient/
  // hemisphere lights are not supported. Directional and point lights are kept.
  snapshot.fog = null;
  if (snapshot.environment) snapshot.environment = copyTexture(snapshot.environment);
  if (snapshot.background instanceof Texture && ![...textures.values()].includes(snapshot.background)) snapshot.background = copyTexture(snapshot.background);
  snapshot.updateMatrixWorld(true);
  let disposed = false;
  return {scene: snapshot, camera: view, dispose: () => {
    if (disposed) return; disposed = true;
    geometries.forEach(geometry => geometry.dispose()); ownedMaterials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
    geometries.clear(); materials.clear(); ownedMaterials.clear(); textures.clear(); snapshot.clear();
  }};
}
