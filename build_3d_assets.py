import os
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE_DIR, "assets")
SRC_IMG = os.path.join(OUT_DIR, "source_cg_reference.jpg")
os.makedirs(OUT_DIR, exist_ok=True)

# 1. Load source 1:1 CG render and save crisp 1536x1536 HD albedo texture
img = Image.open(SRC_IMG).convert("RGB")
img_hd = img.resize((1536, 1536), Image.Resampling.LANCZOS)
img_hd = img_hd.filter(ImageFilter.UnsharpMask(radius=1.1, percent=35, threshold=2))
img_hd.save(os.path.join(OUT_DIR, "albedo_hd.jpg"), quality=97, subsampling=0)

# Work on 1024x1024 grid for depth, normal, and semantic rig maps
N = 1024
arr = np.asarray(img.resize((N, N), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
R, G, B = arr[..., 0], arr[..., 1], arr[..., 2]
luma = 0.299 * R + 0.587 * G + 0.114 * B
pinkness = np.clip(R - 0.5 * (G + B), 0.0, 1.0)
saturation = np.max(arr, axis=-1) - np.min(arr, axis=-1)

# Normalized image coordinates x in [0, 1] (left->right), y in [0, 1] (top->bottom)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / (N - 1.0)

def ellip_gauss(cx, cy, rx, ry, angle_deg=0.0, power=2.0):
    th = np.deg2rad(angle_deg)
    dx = xx - cx
    dy = yy - cy
    u = (dx * np.cos(th) + dy * np.sin(th)) / rx
    v = (-dx * np.sin(th) + dy * np.cos(th)) / ry
    r2 = u * u + v * v
    return np.exp(-0.5 * np.power(r2, power * 0.5))

def dome(cx, cy, rx, ry, angle_deg=0.0):
    th = np.deg2rad(angle_deg)
    dx = xx - cx
    dy = yy - cy
    u = (dx * np.cos(th) + dy * np.sin(th)) / rx
    v = (-dx * np.sin(th) + dy * np.cos(th)) / ry
    r2 = np.clip(1.0 - (u * u + v * v), 0.0, 1.0)
    return np.sqrt(r2)

# --- A. Foreground Subject Silhouette Mask ---
# Detect character vs pure pearl-white upper-left studio background
bg_likelihood = (
    (luma > 0.945).astype(np.float32) * (saturation < 0.025).astype(np.float32) *
    np.clip(1.2 - ellip_gauss(0.62, 0.52, 0.36, 0.52, -12.0), 0.0, 1.0)
)
fg_raw = 1.0 - gaussian_filter(bg_likelihood, sigma=8.0)
# Reinforce core character anatomy silhouette
core_body = np.maximum.reduce([
    dome(0.65, 0.26, 0.28, 0.27, -10.0),      # Crown & hair volume
    dome(0.57, 0.36, 0.16, 0.14, 18.0),       # Face
    dome(0.62, 0.62, 0.13, 0.15, -8.0),       # Bare left shoulder
    dome(0.44, 0.62, 0.10, 0.14, 15.0),       # Clasped hands
    dome(0.53, 0.86, 0.28, 0.22, 0.0),        # Ruffled dress
    ellip_gauss(0.32, 0.66, 0.22, 0.30, -32.0) * np.clip((0.97 - luma) * 18.0 + pinkness * 22.0, 0.0, 1.0), # Flowing left hair
    ellip_gauss(0.84, 0.56, 0.15, 0.44, 6.0), # Right side hair & silk bow
])
fg_mask = np.clip(np.maximum(fg_raw * 0.85, (core_body > 0.08).astype(np.float32)), 0.0, 1.0)
fg_mask = gaussian_filter(fg_mask, sigma=6.0)

# --- B. Smooth Anatomical 3D Depth Field + Micro-Detail SfS Relief ---
depth = np.zeros((N, N), dtype=np.float32)

# 1. Back & flowing hair volume layer
depth = np.maximum(depth, 0.28 * ellip_gauss(0.66, 0.28, 0.29, 0.30, -10.0))
depth = np.maximum(depth, 0.24 * ellip_gauss(0.34, 0.62, 0.25, 0.34, -32.0) * fg_mask)
depth = np.maximum(depth, 0.30 * ellip_gauss(0.83, 0.62, 0.15, 0.42, 4.0))

# 2. 3/4 Sculpted Anime Head & Face Volume
head_dome = dome(0.61, 0.30, 0.22, 0.24, 12.0) * 0.52
face_plane = dome(0.555, 0.365, 0.135, 0.135, 22.0) * 0.58
depth = np.maximum(depth, np.maximum(head_dome, face_plane))

# Subtle facial features on top of face_plane: nose bridge/tip, soft cheek, eye recesses, ear, silk bow
nose_tip = ellip_gauss(0.506, 0.372, 0.018, 0.024, 20.0) * 0.032
cheek_near = ellip_gauss(0.565, 0.410, 0.048, 0.038, 22.0) * 0.026
eye_recess_near = ellip_gauss(0.612, 0.372, 0.042, 0.026, 26.0) * 0.022
eye_recess_far = ellip_gauss(0.495, 0.295, 0.024, 0.024, 32.0) * 0.018
silk_bow = ellip_gauss(0.870, 0.365, 0.085, 0.075, -10.0) * 0.095
ear_relief = ellip_gauss(0.768, 0.426, 0.032, 0.038, 15.0) * 0.035

# 3. Neck, Foreground Bare Left Shoulder, Clasped Hands & Ruffled Dress
neck_cyl = ellip_gauss(0.64, 0.49, 0.065, 0.065, 10.0) * 0.44
shoulder_dome = dome(0.618, 0.625, 0.115, 0.135, -6.0) * 0.72
hands_dome = dome(0.438, 0.605, 0.092, 0.125, 16.0) * 0.78
forearms = (
    ellip_gauss(0.445, 0.78, 0.048, 0.16, -8.0) * 0.74 +
    ellip_gauss(0.382, 0.74, 0.038, 0.14, 12.0) * 0.68
)
dress_volume = dome(0.53, 0.88, 0.29, 0.26, -5.0) * 0.70

depth = np.maximum.reduce([depth, neck_cyl, shoulder_dome, hands_dome, forearms, dress_volume])
depth += nose_tip + cheek_near + silk_bow + ear_relief - eye_recess_near - eye_recess_far

# Smooth macro 3D anatomy so mesh has zero sharp steps or silhouette tearing!
depth_macro = gaussian_filter(depth, sigma=14.0) * gaussian_filter(fg_mask, sigma=12.0)

# Add fine Shape-from-Shading (SfS) micro-relief (hair strands, silk bow weave, organza folds!)
luma_blur_sm = gaussian_filter(luma, sigma=1.6)
luma_blur_lg = gaussian_filter(luma, sigma=9.0)
micro_relief = (luma_blur_sm - luma_blur_lg) * 0.055 * fg_mask

depth_total = np.clip(depth_macro + micro_relief, 0.0, 1.0)

# Save 16-bit precision packed into RG channels (R = high byte, G = low byte) so WebGL has zero 8-bit stepping!
depth_u16 = np.round(depth_total * 65535.0).astype(np.uint16)
depth_rgb = np.stack([
    (depth_u16 >> 8).astype(np.uint8),
    (depth_u16 & 255).astype(np.uint8),
    np.round(depth_total * 255.0).astype(np.uint8),
], axis=-1)
Image.fromarray(depth_rgb).save(os.path.join(OUT_DIR, "depth_map.png"))

# --- C. Surface Normal Map from Macro + Micro Heightfield ---
# Stronger micro-detail weight in normal map for crisp 3D hair & fabric sheen relighting!
normal_h = depth_macro * 0.55 + (luma_blur_sm - gaussian_filter(luma, sigma=5.5)) * 0.045 * fg_mask
dz_dy, dz_dx = np.gradient(normal_h * 260.0)
nx = -dz_dx
ny = dz_dy # +Y up in OpenGL UV space
nz = np.ones_like(nx)
norm_len = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
nx /= norm_len
ny /= norm_len
nz /= norm_len
normal_rgb = np.clip((np.stack([nx, ny, nz], axis=-1) * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
Image.fromarray(normal_rgb).save(os.path.join(OUT_DIR, "normal_map.png"))

# --- D. Semantic Physics & Performance Rig Masks (RGBA) ---
# Rigid lock zone: face, eyes, nose, mouth, chin, ear, hands, forearms, bare shoulder MUST NOT wobble with wind!
face_lock = ellip_gauss(0.575, 0.370, 0.145, 0.125, 22.0, power=3.2)
ear_bow_knot_lock = ellip_gauss(0.82, 0.39, 0.075, 0.055, 0.0, power=3.0)
hands_arms_lock = np.clip(
    ellip_gauss(0.438, 0.605, 0.095, 0.125, 16.0, power=3.0) +
    ellip_gauss(0.448, 0.80, 0.055, 0.18, -8.0, power=3.0) +
    ellip_gauss(0.382, 0.74, 0.042, 0.13, 12.0, power=3.0),
    0.0, 1.0
)
shoulder_lock = ellip_gauss(0.620, 0.615, 0.105, 0.115, -6.0, power=3.0)
crown_root_lock = ellip_gauss(0.675, 0.055, 0.16, 0.065, 0.0, power=2.5)

rigid_lock = np.clip(
    np.maximum.reduce([face_lock, ear_bow_knot_lock, hands_arms_lock, shoulder_lock, crown_root_lock]),
    0.0, 1.0
)

# 1. R Channel: Hair Physics Weight (smoothly increases toward flowing hair tips!)
hair_region = np.clip(
    ellip_gauss(0.28, 0.62, 0.28, 0.38, -28.0) * 1.15 +   # Long left-sweeping hair
    ellip_gauss(0.86, 0.68, 0.14, 0.34, 5.0) * 0.85 +     # Long right-side hair
    ellip_gauss(0.58, 0.25, 0.14, 0.08, 15.0) * 0.22,     # Gentle airy bang tips
    0.0, 1.0
)
# Exclude crystals in top-left/bottom-left & dress ruffles
dress_zone = ellip_gauss(0.53, 0.86, 0.26, 0.18, -5.0, power=2.6)
hair_weight = hair_region * (1.0 - rigid_lock) * (1.0 - dress_zone * 0.85) * fg_mask
hair_weight = gaussian_filter(np.clip(hair_weight, 0.0, 1.0), sigma=6.0)

# 2. G Channel: Cloth & Silk Bow Tail Flutter Weight
bow_tails = ellip_gauss(0.865, 0.475, 0.095, 0.095, -8.0) * (1.0 - ellip_gauss(0.870, 0.345, 0.05, 0.04))
ruffle_cloth = dress_zone * (1.0 - hands_arms_lock) * (1.0 - shoulder_lock)
cloth_weight = gaussian_filter(np.clip(np.maximum(bow_tails * 0.95, ruffle_cloth * 0.88), 0.0, 1.0), sigma=5.0)

# 3. B Channel: Translucent Backlit Hair & Organza Rim Mask
grad_fg = np.hypot(*np.gradient(gaussian_filter(fg_mask, sigma=3.0)))
silhouette_rim = np.clip(grad_fg * 18.0, 0.0, 1.0)
pink_hair_rim = np.clip(pinkness * 7.5 + (luma > 0.82).astype(np.float32) * hair_weight * 0.65, 0.0, 1.0) * fg_mask
rim_mask = gaussian_filter(np.clip(silhouette_rim * 0.65 + pink_hair_rim * 0.65 + cloth_weight * 0.35, 0.0, 1.0), sigma=3.0)

rig_rgba = np.stack([
    np.round(hair_weight * 255.0).astype(np.uint8),
    np.round(cloth_weight * 255.0).astype(np.uint8),
    np.round(rim_mask * 255.0).astype(np.uint8),
    np.round(fg_mask * 255.0).astype(np.uint8),
], axis=-1)
Image.fromarray(rig_rgba).save(os.path.join(OUT_DIR, "rig_masks.png"))

print("Successfully generated 3D reconstruction assets in:", OUT_DIR)
