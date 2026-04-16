import { createApp } from 'vue';
import App from './App.vue';
import { initUILayout } from './ui-layout';

createApp(App).mount('#app');
initUILayout();

void import('./bootstrapGame');
