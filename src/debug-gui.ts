/**
 * Live tuning panel.
 *
 * Split out of the main loop because tuning is the whole workflow here and the
 * bindings otherwise crowd out the game logic.
 */

import GUI from 'lil-gui';

import type { FlightParams } from './sim/flight';
import type { CameraParams } from './render/camera';

export interface DebugGui {
  dispose(): void;
}

export function createDebugGui(
  flight: FlightParams,
  camera: CameraParams,
  actions: { respawn(): void },
): DebugGui {
  const gui = new GUI({ title: 'pigeon sim' });

  const flightFolder = gui.addFolder('flight');
  flightFolder.add(flight, 'wingArea', 0.02, 0.15, 0.001);
  flightFolder.add(flight, 'liftSlope', 1, 8, 0.1);
  flightFolder.add(flight, 'stallAngle', 0.1, 0.6, 0.01);
  flightFolder.add(flight, 'dragBase', 0.005, 0.2, 0.005);
  flightFolder.add(flight, 'inducedDrag', 0.01, 0.3, 0.005);
  flightFolder.add(flight, 'keelDrag', 0, 1.5, 0.05);
  flightFolder.add(flight, 'trimAngle', 0, 0.3, 0.005);
  flightFolder.add(flight, 'mass', 0.15, 1.2, 0.01);

  const brakeFolder = gui.addFolder('braking');
  brakeFolder.add(flight, 'brakeAreaFactor', 1, 2.5, 0.05).name('wing + tail spread');
  brakeFolder.add(flight, 'brakeDragFactor', 1, 8, 0.1).name('drag multiplier');
  brakeFolder.add(flight, 'brakeStallBonus', 0, 0.8, 0.01).name('alula stall bonus');
  brakeFolder.add(flight, 'brakeFlapReverse', 0, 3, 0.05).name('reverse beat strength');
  brakeFolder.add(flight, 'brakeFlapAngle', 0.2, 1.55, 0.01).name('reverse beat angle');
  brakeFolder.close();

  const flapFolder = gui.addFolder('wingbeat');
  flapFolder.add(flight, 'flapThrust', 0, 12, 0.1);
  flapFolder.add(flight, 'flapFrequency', 1, 12, 0.1);
  flapFolder.add(flight, 'flapAngle', 0, 1.2, 0.01);
  flapFolder.add(flight, 'flapStaminaCost', 0, 0.5, 0.01);
  flapFolder.add(flight, 'staminaRecovery', 0, 0.5, 0.01);
  flapFolder.close();

  const handlingFolder = gui.addFolder('handling');
  handlingFolder.add(flight, 'pitchRate', 0.2, 6, 0.1);
  handlingFolder.add(flight, 'rollRate', 0.2, 8, 0.1);
  handlingFolder.add(flight, 'yawRate', 0, 4, 0.05);
  handlingFolder.add(flight, 'controlHalfLife', 0.01, 0.5, 0.01);
  handlingFolder.add(flight, 'pitchStability', 0, 8, 0.1);
  handlingFolder.add(flight, 'yawStability', 0, 8, 0.1);
  handlingFolder.close();

  const collisionFolder = gui.addFolder('collision');
  collisionFolder.add(flight, 'bodyRadius', 0.05, 2, 0.01);
  // Raise this past any speed you can reach to make walls non-lethal.
  collisionFolder.add(flight, 'crashSpeed', 0, 60, 0.5).name('crashSpeed (walls)');
  collisionFolder.close();

  // The three limits a touchdown is judged against. Widen them to practise the
  // rest of the flight without the approach ending every run.
  const landingFolder = gui.addFolder('landing');
  landingFolder.add(flight, 'landingSink', 0.5, 20, 0.1).name('max sink (m/s)');
  landingFolder.add(flight, 'landingSpeed', 2, 40, 0.5).name('max speed (m/s)');
  landingFolder.add(flight, 'landingBank', 0.05, 1.5, 0.01).name('max bank (rad)');
  landingFolder.close();

  const cameraFolder = gui.addFolder('camera');
  cameraFolder.add(camera, 'distance', 1, 20, 0.1);
  cameraFolder.add(camera, 'height', -2, 8, 0.1);
  cameraFolder.add(camera, 'lookAhead', 0, 40, 0.5);
  cameraFolder.add(camera, 'positionHalfLife', 0.01, 0.6, 0.005);
  cameraFolder.add(camera, 'rollFollow', 0, 1, 0.05);
  cameraFolder.add(camera, 'baseFov', 40, 110, 1);
  cameraFolder.add(camera, 'fovGain', 0, 50, 1);
  cameraFolder.close();

  gui.add(actions, 'respawn').name('respawn (R)');

  // H hides the panel for an unobstructed look at the world.
  let visible = true;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyH') return;
    visible = !visible;
    gui.show(visible);
  };
  window.addEventListener('keydown', onKeyDown);

  return {
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      gui.destroy();
    },
  };
}
