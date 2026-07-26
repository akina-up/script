"""
dr_stats.py - Audio measurement report generator

Two modes of operation:
1) Pass a .txt file        : render the text as <name>_dr_stats.png (legacy behavior,
                             the input txt is kept)
2) Pass an audio file      : run the full measurement pipeline:
     a. sox <file> -n stats             amplitude statistics
     b. foobar2000 DR Meter component   dynamic range (foobar2000 is restarted for
                                        every file to guarantee a clean state)
     c. merge both results into <name>.txt (formatted like the reference template)
     d. render <name>_dr_stats.png
     e. delete the intermediate txt (use --keep-txt to keep it)

Command line flags:
    --no-pause   do not wait for Enter at the end (used by audio.bat)
    --keep-txt   keep the merged intermediate txt file

One-time prerequisite: in foobar2000 Preferences > Advanced > Tools > DR Meter enable
    [x] Automatically save logs
    [x] Quiet mode (no result dialog)
Requires the foo_dr_meter component (DR Meter by Case).
"""
import ctypes
import os
import re
import subprocess
import sys
import time

from PIL import Image, ImageDraw, ImageFont

# ==========================================
# Constants
# ==========================================
SEP = '-' * 132                     # separator line used in the merged report
AUDIO_EXTS = {'.flac', '.wav', '.wv', '.ape', '.tak', '.tta', '.m4a', '.mp3', '.ogg', '.opus'}
FB2K_CANDIDATES = [
    os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'foobar2000.exe')),
    r'C:\Program Files\foobar2000\foobar2000.exe',
]
DR_CONTEXT_COMMAND = '/context_command:Measure Dynamic Range'
DR_TIMEOUT = 600                    # per-file DR measurement timeout (seconds)
FB2K_START_WAIT = 6                 # wait for foobar2000 core init after launch (seconds)


# ==========================================
# foobar2000 DR measurement
# ==========================================
def find_fb2k():
    for p in FB2K_CANDIDATES:
        if os.path.isfile(p):
            return p
    return None


def fb2k_running():
    out = subprocess.run(
        ['tasklist', '/FI', 'IMAGENAME eq foobar2000.exe'],
        capture_output=True, text=True, errors='replace',
    ).stdout or ''
    return 'foobar2000.exe' in out


def fb2k_exit(fb2k, wait=20):
    """Exit foobar2000 gracefully (never force-kill: a hard kill makes the next
    startup show an 'improper shutdown' dialog that blocks command processing)."""
    if not fb2k_running():
        return True
    subprocess.Popen([fb2k, '/exit'])
    deadline = time.time() + wait
    while time.time() < deadline:
        if not fb2k_running():
            return True
        time.sleep(0.5)
    return False


def dr_progress_visible():
    """Return True if the DR Meter progress window is visible
    (its title contains 'Dynamic Range Measurement')."""
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def cb(hwnd, lparam):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                if 'Dynamic Range Measurement' in buf.value:
                    found.append(buf.value)
        return True

    user32.EnumWindows(cb, 0)
    return bool(found)


def measure_dr(audio_path):
    """Measure DR with the foobar2000 foo_dr_meter component, return the contents
    of the auto-written foo_dr.txt log.
    foobar2000 is restarted for every file: close any existing instance ->
    fresh hidden start -> measure -> exit."""
    fb2k = find_fb2k()
    if not fb2k:
        raise RuntimeError('foobar2000.exe not found')
    audio_path = os.path.abspath(audio_path)
    log_path = os.path.join(os.path.dirname(audio_path), 'foo_dr.txt')

    # --- restart per file: close any existing instance first ---
    if fb2k_running():
        print('  Closing existing foobar2000 instance...')
        if not fb2k_exit(fb2k):
            print('  Warning: existing instance did not exit, using it as-is '
                  '(check for blocking dialogs)')

    if not fb2k_running():
        print('  Starting foobar2000 in the background...')
        subprocess.Popen([fb2k, '/hide'])
        deadline = time.time() + 30
        while not fb2k_running():
            if time.time() > deadline:
                raise RuntimeError('Failed to start foobar2000')
            time.sleep(0.25)
        time.sleep(FB2K_START_WAIT)

    # --- send the measurement command (list args are quoted automatically) ---
    scan_start = time.time() - 2
    print('  Sending DR measurement command...')
    subprocess.Popen([fb2k, DR_CONTEXT_COMMAND, audio_path])

    content = None
    seen_progress = False
    resend_at = time.time() + 30
    deadline = time.time() + DR_TIMEOUT
    try:
        while time.time() < deadline:
            if os.path.isfile(log_path) and os.path.getmtime(log_path) > scan_start:
                time.sleep(0.5)  # make sure the write is finished
                with open(log_path, 'r', encoding='utf-8-sig', errors='replace') as f:
                    content = f.read()
                break
            if not seen_progress and dr_progress_visible():
                seen_progress = True
            if not seen_progress and time.time() > resend_at:
                print('  No measurement progress detected, resending command...')
                subprocess.Popen([fb2k, DR_CONTEXT_COMMAND, audio_path])
                resend_at = time.time() + 30
            time.sleep(0.5)
    finally:
        # --- restart per file: always exit fb2k when done (or failed) ---
        fb2k_exit(fb2k)

    if content is None:
        raise RuntimeError(
            'DR measurement timed out: foo_dr.txt was not generated. Make sure '
            'foobar2000 Preferences > Advanced > Tools > DR Meter has '
            '"Automatically save logs" and "Quiet mode (no result dialog)" enabled'
        )

    try:
        os.remove(log_path)  # foo_dr.txt is no longer needed
    except OSError:
        pass
    return content


def parse_dr_log(log_text):
    """Extract the per-channel stats block and the Official/Weighted DR line(s)
    from foo_dr.txt.
    The channel block sits between the 2nd and 3rd dashed separator lines; the
    inter-column '---' fillers are replaced with spaces to match the template."""
    lines = log_text.splitlines()
    dash_idx = [i for i, ln in enumerate(lines) if re.fullmatch(r'-{20,}', ln.strip())]

    block = []
    if len(dash_idx) >= 3:
        block = lines[dash_idx[1] + 1: dash_idx[2]]
        while block and not block[0].strip():
            block.pop(0)
        while block and not block[-1].strip():
            block.pop()
        block = [re.sub(r'(?<=\s)---(?=\s)', '   ', ln).rstrip() for ln in block]

    official = [ln.strip() for ln in lines
                if re.match(r'^(Official|Weighted) DR value:', ln.strip())]
    return block, official


# ==========================================
# sox amplitude statistics
# ==========================================
def run_sox_stats(audio_path):
    try:
        r = subprocess.run(['sox', audio_path, '-n', 'stats'],
                           capture_output=True, text=True, errors='replace')
    except FileNotFoundError:
        raise RuntimeError('sox not found, make sure sox is in PATH')
    out = (r.stdout or '') + (r.stderr or '')   # sox stats prints to stderr
    if not out.strip():
        raise RuntimeError('sox stats produced no output')
    return out.replace('\r\n', '\n').strip('\n')


# ==========================================
# Merged report (same layout as the reference template)
# ==========================================
def build_report_text(audio_path):
    name = os.path.basename(audio_path)
    print('  Running sox stats...')
    sox_stats = run_sox_stats(audio_path)
    print('  Running foobar2000 DR Meter...')
    dr_log = measure_dr(audio_path)
    block, official = parse_dr_log(dr_log)

    parts = [name, SEP, sox_stats, '', SEP, '']
    parts += block if block else ['(failed to parse DR channel data)']
    parts += [SEP, '']
    parts += official if official else ['(Official DR value not found)']
    return '\n'.join(parts) + '\n'


# ==========================================
# Text-to-PNG rendering
# ==========================================
def load_font(font_size):
    for name in ('cour.ttf', 'DejaVuSansMono.ttf', 'Menlo.ttc'):
        try:
            return ImageFont.truetype(name, font_size)
        except IOError:
            continue
    print('Warning: no monospace font found, column alignment may be imperfect.')
    return ImageFont.load_default()


def render_text_to_png(text_content, output_filename):
    bg_color = (0, 0, 0)          # black background
    text_color = (255, 255, 255)  # white text
    font_size = 40
    padding = 60
    line_spacing = 10

    font = load_font(font_size)

    dummy_img = Image.new("RGB", (1, 1))
    draw = ImageDraw.Draw(dummy_img)
    bbox = draw.multiline_textbbox((0, 0), text_content, font=font, spacing=line_spacing)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    img = Image.new("RGB", (text_width + padding * 2, text_height + padding * 2), color=bg_color)
    draw = ImageDraw.Draw(img)
    draw.multiline_text((padding, padding), text_content, font=font, fill=text_color, spacing=line_spacing)
    img.save(output_filename)
    print(f'Done! Image saved: [{output_filename}]')


# ==========================================
# Processing entry points
# ==========================================
def convert_txt_to_png(input_filepath):
    """Legacy mode: render a txt file as png (the input file is kept)."""
    if not os.path.exists(input_filepath):
        print(f"Error: file not found '{input_filepath}'")
        return False
    try:
        with open(input_filepath, 'r', encoding='utf-8') as f:
            text_content = f.read()
    except UnicodeDecodeError:
        with open(input_filepath, 'r', encoding='gbk') as f:
            text_content = f.read()
    base_name, _ = os.path.splitext(input_filepath)
    render_text_to_png(text_content, f"{base_name}_dr_stats.png")
    return True


def process_audio_file(audio_path, keep_txt=False):
    """Full pipeline: sox stats + fb2k DR -> merged txt -> png -> delete txt."""
    audio_path = os.path.abspath(audio_path)
    if not os.path.isfile(audio_path):
        print(f'Error: file not found {audio_path}')
        return False
    print(f'Processing: {audio_path}')

    text = build_report_text(audio_path)

    base, _ = os.path.splitext(audio_path)
    txt_path = base + '.txt'
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write(text)

    render_text_to_png(text, base + '_dr_stats.png')

    if keep_txt:
        print(f'  Kept intermediate file: {txt_path}')
    else:
        try:
            os.remove(txt_path)
            print(f'  Deleted intermediate file: {txt_path}')
        except OSError as e:
            print(f'  Warning: failed to delete {txt_path}: {e}')
    return True


# ==========================================
# Main
# ==========================================
if __name__ == "__main__":
    no_pause = False
    keep_txt = False
    paths = []
    for a in sys.argv[1:]:
        if a == '--no-pause':
            no_pause = True
        elif a == '--keep-txt':
            keep_txt = True
        else:
            paths.append(a)

    if not paths:
        print('Usage: drop a .txt file (render only) or an audio file (full measurement)')
        print('       onto this script, or run:')
        print('       python dr_stats.py [--no-pause] [--keep-txt] <files...>')

    exit_code = 0
    for file_path in paths:
        ext = os.path.splitext(file_path)[1].lower()
        try:
            if ext == '.txt':
                if not convert_txt_to_png(file_path):
                    exit_code = 1
            elif ext in AUDIO_EXTS:
                if not process_audio_file(file_path, keep_txt=keep_txt):
                    exit_code = 1
            else:
                print(f'Skipping unsupported file: {file_path}')
        except Exception as e:
            print(f'FAILED [{file_path}]: {e}')
            exit_code = 1

    if not no_pause:
        print("-" * 40)
        input("Done. Press Enter to exit...")
    sys.exit(exit_code)
