from PIL import Image, ImageDraw
import os
from pathlib import Path
import math

def draw_ellipse_and_mask(image):
    width, height = image.size
    
    # Create a mask image with the same size as the original image
    mask = Image.new('L', (width, height), 0)  # 'L' mode for grayscale
    draw = ImageDraw.Draw(mask)
    
    # Draw an ellipse on the mask
    # The ellipse will use the width and height as the major and minor axes
    draw.ellipse((0, 0, width, height), fill=255)
    
    # Create a new image with a white background
    result = Image.new('RGB', (width, height), (255, 255, 255))
    
    # Paste the original image onto the result, using the mask
    result.paste(image, mask=mask)
    
    return result

def process_folder(file_path):
    # for filename in os.listdir(folder_path):
    if file_path.lower().endswith(('.jpg', '.png', '.jpeg')):
        # file_path = os.path.join(folder_path, filename)
        filename, folder_path = Path(file_path).name , Path(file_path).parent
        with Image.open(file_path) as img:
            # Convert to RGB if not already
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            # Draw the ellipse and mask
            result_image = draw_ellipse_and_mask(img)
            
            # Save the result
            output_path = os.path.join(folder_path, f"ellipse_{filename}")
            result_image.save(output_path)
            print(f"Processed and saved: {output_path}")

if __name__ == "__main__":
    folder_path = "data/yuanbo.jpg"  # Replace with your folder path
    process_folder(folder_path)