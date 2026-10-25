/* Browser-only test data. */
async function seedEditorHistory(page, svg) {
  await page.evaluate(async imageSvg => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lfn-image-editor-history-v1', 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of ['studio-source', 'branches', 'nodes', 'images', 'projects']) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
        const nodes = request.transaction.objectStore('nodes');
        for (const key of ['draftId', 'imageId']) if (!nodes.indexNames.contains(key)) nodes.createIndex(key, key);
        const branches = request.transaction.objectStore('branches');
        if (!branches.indexNames.contains('draftId')) branches.createIndex('draftId', 'draftId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = Date.UTC(2026, 9, 23, 12);
    const document = { version: 1, worldRect: { x: 0, y: 0, width: 64, height: 96 }, source: { name: '山间旅行' }, prompt: 'Landscape with mountains, blue sky, clouds and warm sunlight.', negativePrompt: 'low quality, watermark', generation: { model: 'nai-v5-full', width: 832, height: 1216, steps: 28, scale: 5, strength: .7, sampler: 'k_euler_ancestral' }, revision: 1 };
    const workspace = { viewport: { x: 0, y: 0, width: 64, height: 96 }, camera: { x: 0, y: 0, zoom: 1 }, strokes: [], undone: [], tool: 'brush', brushSize: 16, maskColor: '#ff0000', maskOpacity: .5, showMaskPreview: true, canvasBackground: 'checker' };
    const nodes = [0, 1, 2].map(i => ({ version: 2, id: `layout-node-${i}`, draftId: 'layout-project', branchId: i === 2 ? 'layout-branch-b' : 'layout-branch', parentId: i ? 'layout-node-0' : null, imageId: `layout-image-${i}`, mode: i === 2 ? 'canvas' : 'inpaint', tileScale: 2, document, workspace, label: i === 0 ? '初始源图' : i === 1 ? '局部重绘 · 山间旅行' : '无限画布 · 扩展风景', thumbnail: `data:image/svg+xml,${encodeURIComponent(imageSvg)}`, createdAt: now + i * 1000, resultOperation: i === 0 ? undefined : i === 1 ? 'inpaint' : 'canvas', imageWidth: 64, imageHeight: 96 }));
    const tx = db.transaction(['nodes', 'images', 'branches', 'projects'], 'readwrite');
    for (const node of nodes) {
      tx.objectStore('nodes').put(node);
      const pixels = new Uint8ClampedArray(64 * 96 * 4);
      for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 110; pixels[i + 1] = 160 + (i % 32); pixels[i + 2] = 180; pixels[i + 3] = 255; }
      tx.objectStore('images').put({ id: node.imageId, width: 64, height: 96, data: pixels });
    }
    tx.objectStore('branches').put({ id: 'layout-branch', draftId: 'layout-project', name: '主分支', headId: 'layout-node-1', createdAt: now, updatedAt: now + 1000 });
    tx.objectStore('branches').put({ id: 'layout-branch-b', draftId: 'layout-project', name: '扩图方案', headId: 'layout-node-2', createdAt: now + 1000, updatedAt: now + 2000 });
    tx.objectStore('projects').put({ id: 'layout-project', name: '山间旅行 · 版本验收', updatedAt: now + 2000 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, svg);
}
module.exports = { seedEditorHistory };
