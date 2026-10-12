# Save the Universe (spec)

**The founder's prompt (12 Oct, his words):**

> small computer game. there is black hole on the screen in the top right. it is draging video inside it. like assume user camera is on and dragging himself insdie blackhole. or they can give any website link or take my twitter profile as same background. backhole pull everything inside it. user job is stop that. they are pretty close to blackhome and should movie away from it by gaiing more speed and press a save universe button which is other side of the screen.
>
> build a game ... for mobile its top to bottom of bigger screens its left to right

**What was built from it:**

- **Backgrounds:**
  - your camera
  - any browser tab, via the share-a-tab picker on laptops (a pasted link can't be drawn: browsers block it)
  - a photo
  - a built-in starfield
- **Layout:** the black hole sits at the top on tall screens and the goal button at the bottom. On wide screens the hole is on the left and the goal on the right.
- **You:** a glowing bubble with your face from the camera in it.
- **Physics:** you start in a decaying orbit. Your thrust is weaker than the pull, so you have to push along your orbit to build speed, swing out, and fly to the "Save the universe" button. Doing nothing spirals you in within about 3 s, and the hole grows hungrier every second.
- **Losing:** you stretch into a thin line, and the whole picture spirals into the hole.
- **Winning:** the hole collapses, and the picture springs back with a flash.
- **Rendering:**
  - one full-screen WebGL2 shader: gravitational lensing (r - E²/r), redshift, a tilted spinning gas disk with a Doppler-bright side, and a photon ring
  - no libraries, nothing uploaded
