export interface PanoramaRecord {
  id: string;
  projectKey: string;
  sceneKey: string;
  roomId: string;
  roomName: string;
  styleId: string;
  styleName: string;
  image: string;
  model: string;
  createdAt: number;
  source: 'generated' | 'upload';
}

const DATABASE = 'roomcraft.panoramas.v1';
const STORE = 'panoramas';
const KEEP = 8;
function validRecord(value: unknown): value is PanoramaRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PanoramaRecord>;
  return ['id', 'projectKey', 'sceneKey', 'roomId', 'roomName', 'styleId', 'styleName', 'model'].every(key => typeof item[key as keyof PanoramaRecord] === 'string') &&
    typeof item.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(item.image) && item.image.length < 30 * 1024 * 1024 &&
    Number.isFinite(item.createdAt) && (item.source === 'generated' || item.source === 'upload');
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器不支持全景保存，请下载原图')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本机全景记录，请下载原图'));
    request.onblocked = () => reject(new Error('全景存储被其他页面占用，请关闭后重试'));
  });
}
function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('全景保存失败，请下载原图'));
    transaction.onabort = () => reject(new Error('全景保存未完成，请下载原图'));
  });
}
export async function loadPanoramas(projectKey: string): Promise<PanoramaRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readonly'), completion = done(transaction);
    let records: unknown[] = [];
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = () => { records = request.result; };
    request.onerror = () => { try { transaction.abort(); } catch { /* The transaction may have already aborted. */ } };
    await completion;
    return records.filter(validRecord).filter(record => record.projectKey === projectKey).sort((a, b) => b.createdAt - a.createdAt).slice(0, KEEP);
  } finally { database.close(); }
}
export async function savePanorama(record: PanoramaRecord): Promise<void> {
  if (!validRecord(record)) throw new Error('全景记录数据无效，未写入本机存储');
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite'), completion = done(transaction), store = transaction.objectStore(STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = (request.result as unknown[]).filter(validRecord).filter(item => item.id !== record.id);
      const ordered = [...records, record].sort((a, b) => b.createdAt - a.createdAt);
      try {
        store.put(record);
        for (const item of ordered.slice(KEEP)) store.delete(item.id);
      } catch { transaction.abort(); }
    };
    request.onerror = () => transaction.abort();
    await completion;
  } finally { database.close(); }
}
