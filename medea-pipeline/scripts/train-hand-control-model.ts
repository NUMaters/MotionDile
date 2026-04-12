import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type MouthLabel = 0 | 1;

type HandSample = {
  mouthLabel?: MouthLabel | number;
  avgCurl?: number;
  tiltAngle?: number;
  targetYaw?: number;
  pitchAngle?: number;
  targetPitch?: number;
};

type DatasetFile = {
  samples?: HandSample[];
};

type LinearFit = { a: number; b: number };

type TrainStats = {
  totalSamples: number;
  openSamples: number;
  closedSamples: number;
  yawSamples: number;
  pitchSamples: number;
  previousSamples?: number;
  mergedSamples?: number;
};

type TrainedMouth = {
  closedCurl: number;
  openCurl: number;
  openThreshold: number;
};

type TrainedNeck = {
  neutralTilt: number;
  yawGain: number;
  maxYaw: number;
  neutralPitchAngle: number;
  pitchGain: number;
  maxPitch: number;
};

type TrainedModel = {
  version: number;
  trainedAt: string;
  stats: TrainStats;
  mouth: TrainedMouth;
  neck: TrainedNeck;
};

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function blendValue(prev: number, next: number, prevWeight: number, nextWeight: number): number {
  const total = prevWeight + nextWeight;
  if (total <= 0) return next;
  return ((prev * prevWeight) + (next * nextWeight)) / total;
}

function linearFit(xs: number[], ys: number[]): LinearFit {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { a: 1, b: 0 };
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  const a = den > 1e-8 ? num / den : 1;
  const b = my - a * mx;
  return { a, b };
}

function train(samples: HandSample[]): TrainedModel {
  const open = samples.filter((s) => s.mouthLabel === 1).map((s) => Number(s.avgCurl));
  const closed = samples.filter((s) => s.mouthLabel === 0).map((s) => Number(s.avgCurl));

  const closedCurl = closed.length ? mean(closed) : 0.35;
  const openCurl = open.length ? mean(open) : 0.8;
  const openThreshold = 0.5;

  const yawSamples = samples.filter((s) => Number.isFinite(s.tiltAngle) && Number.isFinite(s.targetYaw));
  const pitchSamples = samples.filter((s) => Number.isFinite(s.pitchAngle) && Number.isFinite(s.targetPitch));

  const yawFit = linearFit(
    yawSamples.map((s) => Number(s.tiltAngle)),
    yawSamples.map((s) => Number(s.targetYaw)),
  );
  const pitchFit = linearFit(
    pitchSamples.map((s) => Number(s.pitchAngle)),
    pitchSamples.map((s) => Number(s.targetPitch)),
  );

  const neutralTilt = yawFit.a !== 0 ? -yawFit.b / yawFit.a : 0;
  const neutralPitchAngle = pitchFit.a !== 0 ? -pitchFit.b / pitchFit.a : 0;
  const maxYaw = clamp(Math.max(0.4, ...yawSamples.map((s) => Math.abs(Number(s.targetYaw)))), 0.4, 1.2);
  const maxPitch = clamp(Math.max(0.25, ...pitchSamples.map((s) => Math.abs(Number(s.targetPitch)))), 0.25, 1.0);

  return {
    version: 1,
    trainedAt: new Date().toISOString(),
    stats: {
      totalSamples: samples.length,
      openSamples: open.length,
      closedSamples: closed.length,
      yawSamples: yawSamples.length,
      pitchSamples: pitchSamples.length,
    },
    mouth: {
      closedCurl,
      openCurl,
      openThreshold,
    },
    neck: {
      neutralTilt,
      yawGain: yawFit.a,
      maxYaw,
      neutralPitchAngle,
      pitchGain: pitchFit.a,
      maxPitch,
    },
  };
}

function mergeWithPreviousModel(prevModel: unknown, newModel: TrainedModel): TrainedModel {
  if (!prevModel || typeof prevModel !== 'object') return newModel;
  const prev = prevModel as {
    stats?: { totalSamples?: number };
    mouth?: Partial<TrainedMouth>;
    neck?: Partial<TrainedNeck>;
  };
  const prevCount = Number(prev?.stats?.totalSamples || 0);
  const nextCount = Number(newModel?.stats?.totalSamples || 0);
  if (prevCount <= 0 || nextCount <= 0) return newModel;

  return {
    ...newModel,
    trainedAt: new Date().toISOString(),
    stats: {
      ...newModel.stats,
      previousSamples: prevCount,
      mergedSamples: prevCount + nextCount,
    },
    mouth: {
      closedCurl: blendValue(prev.mouth?.closedCurl ?? newModel.mouth.closedCurl, newModel.mouth.closedCurl, prevCount, nextCount),
      openCurl: blendValue(prev.mouth?.openCurl ?? newModel.mouth.openCurl, newModel.mouth.openCurl, prevCount, nextCount),
      openThreshold: blendValue(prev.mouth?.openThreshold ?? newModel.mouth.openThreshold, newModel.mouth.openThreshold, prevCount, nextCount),
    },
    neck: {
      neutralTilt: blendValue(prev.neck?.neutralTilt ?? newModel.neck.neutralTilt, newModel.neck.neutralTilt, prevCount, nextCount),
      yawGain: blendValue(prev.neck?.yawGain ?? newModel.neck.yawGain, newModel.neck.yawGain, prevCount, nextCount),
      maxYaw: clamp(blendValue(prev.neck?.maxYaw ?? newModel.neck.maxYaw, newModel.neck.maxYaw, prevCount, nextCount), 0.3, 1.2),
      neutralPitchAngle: blendValue(prev.neck?.neutralPitchAngle ?? newModel.neck.neutralPitchAngle, newModel.neck.neutralPitchAngle, prevCount, nextCount),
      pitchGain: blendValue(prev.neck?.pitchGain ?? newModel.neck.pitchGain, newModel.neck.pitchGain, prevCount, nextCount),
      maxPitch: clamp(blendValue(prev.neck?.maxPitch ?? newModel.neck.maxPitch, newModel.neck.maxPitch, prevCount, nextCount), 0.2, 1.0),
    },
  };
}

function main(): void {
  const inPath = resolve(process.argv[2] || 'medea-pipeline/data/hand-dataset.json');
  const outPath = resolve(process.argv[3] || 'public/models/hand-control-model.json');
  const mirrorPath = resolve('medea-pipeline/models/hand-control-model.json');

  const raw = JSON.parse(readFileSync(inPath, 'utf8')) as DatasetFile;
  const samples = Array.isArray(raw?.samples) ? raw.samples : [];
  if (!samples.length) {
    throw new Error(`No samples found: ${inPath}`);
  }

  const newModel = train(samples);
  let prevModel: unknown = null;
  try {
    prevModel = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch {
    prevModel = null;
  }
  const model = mergeWithPreviousModel(prevModel, newModel);
  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(dirname(mirrorPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  writeFileSync(mirrorPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  console.log(`[pipeline] trained model written to: ${outPath}`);
  console.log(`[pipeline] mirror written to: ${mirrorPath}`);
  const prevStats = (prevModel as { stats?: { totalSamples?: number } } | null)?.stats;
  if (prevStats?.totalSamples) {
    console.log(`[pipeline] merged with previous model (${prevStats.totalSamples} samples).`);
  }
}

main();
