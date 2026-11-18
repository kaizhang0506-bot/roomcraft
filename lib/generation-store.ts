export interface FrameCamera {x:number;y:number;z:number;dx:number;dy:number;dz:number}
export interface GeneratedImageRecord {
  id: string;
  image: string;
  style: string;
  model: string;
  time: string;
  room: string;
  sourcePlanKey?:string;
  draftKey?: string;
  sceneKey?: string;
  camera?: FrameCamera;
  createdAt: number;
}
const DATABASE = 'roomcraft.generated-images.v1';
const STORE = 'images';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器不支持图片存储，请下载效果图保存')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开浏览器图片存储，请下载效果图保存'));
    request.onblocked = () => reject(new Error('图片存储被其他页面占用，请下载效果图保存'));
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('图片保存失败，请下载原图保存'));
    transaction.onabort = () => reject(new Error('图片保存未完成，请下载原图保存'));
  });
}
export async function loadGeneratedImages(): Promise<GeneratedImageRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readonly');
    const completion = transactionDone(transaction);
    const records = await new Promise<GeneratedImageRecord[]>((resolve, reject) => {
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as GeneratedImageRecord[]);
      request.onerror = () => reject(new Error('无法读取已保存效果图'));
    });
    await completion;
    return records.filter(record => typeof record.id === 'string' && typeof record.image === 'string' && record.image.startsWith('data:image/') && Number.isFinite(record.createdAt))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  } finally { database.close(); }
}
export async function saveGeneratedImage(record: GeneratedImageRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const remaining = (request.result as GeneratedImageRecord[]).filter(item => item.id !== record.id);
      const ordered = [...remaining, record].sort((a, b) => b.createdAt - a.createdAt);
      store.put(record);
      for (const item of ordered.slice(4)) store.delete(item.id);
    };
    request.onerror = () => transaction.abort();
    await completion;
  } finally { database.close(); }
}
