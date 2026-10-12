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

**Follow-ups from the founder after playing it (12 Oct):**

> it is too quick. app opened and game ended atleast give them tutotrial that they have to tap faster first eime. and space vehicle seems pretty big and hard to undersatnd
>
> its not realistic, i mean the pulling insdie part. its not that much fun. hole is too big
>
> pulling has to brealistic like if its a website it has to pull elements one by one.
>
> if tis a universe it has to pull starts
>
> and ifvehile is touch them, those object should darg vehicle down and only way for the vehicle is to take a differetndireciton
>
> even with camera it has to first drag the identified objects.

**What changed:**

- **Tapping:** each tap pushes you toward where you tap, so tapping fast is how you escape. Four taps a second is enough, three barely is.
- **A gentler start:** a 3-step tutorial the first time, a 3-2-1 countdown every game, and a small bubble labelled YOU.
- **A smaller hole,** and the pull ramps up over 3.5 s.
- **The hole tears the screen apart piece by piece,** nearest first:
  - **Pictures:** objects found by MediaPipe EfficientDet-Lite0 (person, cup, laptop…) go first, then tiles.
  - **The universe:** every star and planet, then the sky.
  - **A website:** its menu, headline, buttons and cards, then the page.

  Each piece wobbles loose, spirals in, stretches toward the hole and is gone. Winning brings every piece back.
- **Falling pieces that hit you drag you toward the hole,** so you have to steer around them.
