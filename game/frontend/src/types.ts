import type * as THREE from 'three';

export type HandLm = { x: number; y: number; z: number };

export type HandControlModel = {
  /**
   * 1 = 従来（手首〜中指 MCP の傾き + 指カール）。2 = 掌の法線で首・指の開き比で口。
   */
  version: number;
  mouth: { closedCurl: number; openCurl: number; openThreshold: number };
  neck: {
    neutralTilt: number;
    yawGain: number;
    maxYaw: number;
    neutralPitchAngle: number;
    pitchGain: number;
    maxPitch: number;
  };
};

export type HandLandmarkerVideoResult = {
  landmarks?: HandLm[][];
};

export type NetPlayerState = {
  playerId: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  neckYaw: number;
  neckPitch: number;
  animation: string;
  mouthOpenness: number;
  color: string;
  displayName?: string;
  idleBob?: number;
  idlePitch?: number;
  idleRoll?: number;
  updatedAt: number;
};

export type RoomSnapshot = {
  roomId: string;
  version: number;
  players: NetPlayerState[];
};

export type WsMessage = {
  type: string;
  payload?: unknown;
};

export type RemotePlayer = {
  root: THREE.Group;
  targetPos: THREE.Vector3;
  targetYaw: number;
  targetNeckYaw: number;
  targetNeckPitch: number;
  targetIdleBob: number;
  targetIdlePitch: number;
  targetIdleRoll: number;
  smoothIdleBob: number;
  smoothIdlePitch: number;
  smoothIdleRoll: number;
  prevIdleBob: number;
  smoothNeckYaw: number;
  smoothNeckPitch: number;
  headBone: THREE.Object3D | null;
  headBaseQuat: THREE.Quaternion | null;
  desiredAnimation: string;
  targetMouthOpenness: number;
  smoothMouthOpenness: number;
  actions: Record<string, THREE.AnimationAction>;
  mixer: THREE.AnimationMixer | null;
  isProxy: boolean;
  color: string;
  nameLabel: THREE.Object3D | null;
  displayName: string;
};

export type MovePayload = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  neckYaw: number;
  neckPitch: number;
  animation: string;
  mouthOpenness: number;
  idleBob: number;
  idlePitch: number;
  idleRoll: number;
};
