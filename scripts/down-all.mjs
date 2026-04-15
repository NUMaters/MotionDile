/**
 * Mac / Windows 共通で dev:all が使うポートを解放する。
 */
import killPort from 'kill-port';

const ports = [5173, 8090, 8091];
await Promise.allSettled(ports.map((p) => killPort(p, 'tcp')));
console.log('all stopped');
