"""
Render a text file as a high-resolution PNG image.

Dependency:
    pip install pillow
"""

import argparse
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def read_text(input_path):
    """Read UTF-8 text, with common Windows encodings as fallbacks."""
    for encoding in ("utf-8-sig", "gb18030", "gbk"):
        try:
            return input_path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue

    raise UnicodeError(f"无法识别文本编码: {input_path}")


def load_monospace_font(font_size):
    """Load an available monospaced font, preferring Windows fonts."""
    windows_dir = Path(os.environ.get("WINDIR", r"C:\Windows"))
    font_candidates = (
        windows_dir / "Fonts" / "consola.ttf",
        windows_dir / "Fonts" / "cour.ttf",
        windows_dir / "Fonts" / "lucon.ttf",
        Path("DejaVuSansMono.ttf"),
        Path("Menlo.ttc"),
    )

    for font_path in font_candidates:
        try:
            return ImageFont.truetype(str(font_path), font_size)
        except OSError:
            continue

    print("警告: 未找到等宽字体，列对齐可能不完美。")
    return ImageFont.load_default()


def convert_txt_to_png(input_filepath, output_filepath=None):
    input_path = Path(input_filepath)
    if not input_path.is_file():
        raise FileNotFoundError(f"找不到文件: {input_path}")

    if output_filepath:
        output_path = Path(output_filepath)
    else:
        output_path = input_path.with_name(f"{input_path.stem}_dr_stats.png")

    text_content = read_text(input_path)

    background_color = (0, 0, 0)
    text_color = (255, 255, 255)
    font_size = 40
    padding = 60
    line_spacing = 10
    font = load_monospace_font(font_size)

    measuring_image = Image.new("RGB", (1, 1))
    measuring_draw = ImageDraw.Draw(measuring_image)
    bounds = measuring_draw.multiline_textbbox(
        (0, 0),
        text_content,
        font=font,
        spacing=line_spacing,
    )

    text_width = max(1, bounds[2] - bounds[0])
    text_height = max(1, bounds[3] - bounds[1])
    image_width = text_width + padding * 2
    image_height = text_height + padding * 2

    image = Image.new(
        "RGB",
        (image_width, image_height),
        color=background_color,
    )
    draw = ImageDraw.Draw(image)
    draw.multiline_text(
        (padding - bounds[0], padding - bounds[1]),
        text_content,
        font=font,
        fill=text_color,
        spacing=line_spacing,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG")
    print(f"文本截图已生成: {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="将 TXT 文本渲染为 PNG 图片")
    parser.add_argument("input", help="输入 TXT 文件")
    parser.add_argument("-o", "--output", help="输出 PNG 文件")
    args = parser.parse_args()

    try:
        convert_txt_to_png(args.input, args.output)
    except Exception as error:
        parser.exit(1, f"错误: {error}\n")


if __name__ == "__main__":
    main()
