import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

/**
 * The size a stored profile photo is normalised to.
 *
 * Avatars are drawn between 40 and 68 density-independent pixels, so 256 is sharp even
 * on a 3x screen. It also keeps the encoded image well inside the backend's 64 KB
 * limit, whatever camera the original came from.
 */
export const PHOTO_PIXELS = 256;

/** JPEG quality. High enough that a face still looks like itself at avatar sizes. */
const PHOTO_QUALITY = 0.8;

/**
 * The widest the original is decoded at.
 *
 * A modern phone photo is tens of megapixels; decoding one at full size to make a
 * thumbnail is how an image picker runs a device out of memory. The source is
 * downsampled while it is read instead.
 */
const DECODE_MAX_WIDTH = 2048;

export const PHOTO_CONTENT_TYPE = "image/jpeg";

export type PickedPhoto = {
  /** Base64 JPEG, ready to send to the API. */
  data: string;
  contentType: typeof PHOTO_CONTENT_TYPE;
  /** A data URI of the same image, for the preview before it is saved. */
  previewUri: string;
};

export type PickPhotoResult =
  | { status: "picked"; photo: PickedPhoto }
  | { status: "cancelled" }
  | { status: "failed" };

/**
 * Let the user choose a photo, then square it, shrink it and encode it.
 *
 * The device file the picker returns is a temporary URI in the app's cache: useful for
 * reading the image right now, worthless as a stored reference, since it is not a URL
 * anyone else can fetch and the file itself is cleared. So nothing here keeps it — the
 * image is read, normalised and turned into bytes the backend can own.
 *
 * On Android 13 and later, picking from the library needs no permission: the system
 * photo picker hands back only the chosen file. Nothing is requested, and the app asks
 * for neither camera nor microphone access.
 *
 * Cancelling is an ordinary outcome, not a failure, and is reported as its own status.
 */
export async function pickProfilePhoto(): Promise<PickPhotoResult> {
  let pickedUri: string;
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      // A square crop up front, so what the user framed is what they get. The circle
      // is drawn by the avatar; cropping to one would bake transparency into a JPEG.
      allowsEditing: true,
      aspect: [1, 1],
      shape: "rectangle",
      allowsMultipleSelection: false,
      // Location and camera metadata have no business travelling with an avatar.
      exif: false,
      quality: 1,
    });

    if (result.canceled || !result.assets?.length) return { status: "cancelled" };
    pickedUri = result.assets[0].uri;
  } catch (error) {
    console.error(
      "[photo] Could not open the photo library:",
      error instanceof Error ? error.name : "unknown error",
    );
    return { status: "failed" };
  }

  try {
    const context = ImageManipulator.manipulate(pickedUri, { maxWidth: DECODE_MAX_WIDTH });
    const image = await context.resize({ width: PHOTO_PIXELS, height: PHOTO_PIXELS }).renderAsync();
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: PHOTO_QUALITY,
      base64: true,
    });

    if (!saved.base64) {
      console.error("[photo] The resized image came back without any data.");
      return { status: "failed" };
    }

    return {
      status: "picked",
      photo: {
        data: saved.base64,
        contentType: PHOTO_CONTENT_TYPE,
        previewUri: `data:${PHOTO_CONTENT_TYPE};base64,${saved.base64}`,
      },
    };
  } catch (error) {
    console.error(
      "[photo] Could not prepare the photo:",
      error instanceof Error ? error.name : "unknown error",
    );
    return { status: "failed" };
  }
}
