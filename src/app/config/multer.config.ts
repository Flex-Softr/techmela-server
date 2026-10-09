import fs from "fs";
import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, getUploadFolder());
  },
  filename: function (req, file, cb) {
    const decodedName = Buffer.from(file.originalname, "latin1").toString(
      "utf8"
    );
    cb(null, decodedName);
  },
});

const getUploadFolder = () => {
  // Create a unique folder name using a timestamp
  const timestamp = Date.now();
  const uploadFolder = path.join("uploads/public", String(timestamp));

  // Create the folder if it doesn't exist
  if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
  }

  return uploadFolder;
};

export const upload = multer({ storage });

export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
  },
});
